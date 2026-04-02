import { logger } from "./logger";
import {
  dbSaveTrade,
  dbLoadOpenTrades,
  dbSaveSignal,
  dbSaveEquitySnapshot,
  dbLoadLatestEquity,
} from "./db";
import { detectLuxSMC, buildMarketIntelligenceMessage, type LuxEvent, type OrderBlock, type EqualLevel, type PremiumDiscount } from "../engine/luxSmc";

interface SymbolConfig {
  symbol: string;
  displayName: string;
  coinId: string;
  okxInstId: string;
  okxCcy: string;
}

const SYMBOLS: SymbolConfig[] = [
  { symbol: "BTCUSDT", displayName: "BTC", coinId: "bitcoin",      okxInstId: "BTC-USDT-SWAP", okxCcy: "BTC" },
  { symbol: "ETHUSDT", displayName: "ETH", coinId: "ethereum",     okxInstId: "ETH-USDT-SWAP", okxCcy: "ETH" },
  { symbol: "SOLUSDT", displayName: "SOL", coinId: "solana",       okxInstId: "SOL-USDT-SWAP", okxCcy: "SOL" },
  { symbol: "BNBUSDT", displayName: "BNB", coinId: "binancecoin",  okxInstId: "BNB-USDT-SWAP", okxCcy: "BNB" },
  { symbol: "XRPUSDT", displayName: "XRP", coinId: "ripple",       okxInstId: "XRP-USDT-SWAP", okxCcy: "XRP" },
];

// Public mapping for the candles route
export const SYMBOL_TO_INSTID: Record<string, string> = Object.fromEntries(
  SYMBOLS.map((s) => [s.symbol, s.okxInstId])
);

const SESSIONS = [
  { name: "London",   startHour: 8,  endHour: 12 },
  { name: "New York", startHour: 13, endHour: 17 },
];

const PRICE_HISTORY_SIZE = 120;
const INITIAL_BALANCE    = 1000;
const RISK_PER_TRADE     = 0.02;
const REWARD_MULTIPLIER  = 2;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Candle {
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

export interface CandleWithTime extends Candle {
  time: number;   // Unix seconds
}

export interface Swing {
  type:  "HIGH" | "LOW";
  price: number;
  index: number;
}

export interface FVGZone {
  type:   "BULLISH" | "BEARISH";
  top:    number;
  bottom: number;
}

interface FVGZoneWithTime extends FVGZone {
  time: number;   // Unix seconds (timestamp of the middle candle)
}

interface StructureResult {
  bos:   "BULLISH" | "BEARISH" | null;
  choch: "BULLISH" | "BEARISH" | null;
}

interface SmcAnalysis {
  tf4h:            "bullish" | "bearish" | "neutral";
  tf1h:            "bullish" | "bearish" | "neutral";
  tf15m:           "bullish" | "bearish" | "neutral";
  tf5m:            "bullish" | "bearish" | "neutral";
  bos:             string | null;
  choch:           string | null;
  liquidity:       string | null;
  fvgZones:        FVGZone[];
  hasFVG:          boolean;
  fvgTouch:        "bullish" | "bearish" | null;
  simpleStructure: string;
  price:           number;
  bias:            "BUY" | "SELL" | "NONE";
  htfAligned:      boolean;
  luxEvents:       LuxEvent[];
  orderBlocks:     OrderBlock[];
  equalLevels:     EqualLevel[];
  premiumDiscount: PremiumDiscount;
}

interface LastData {
  priceOkx: number;
  priceCg:  number;
  oi:       number;
  volume:   number;
  funding:  number;
}

interface OkxPrimary {
  price:   number;
  oi:      number;
  funding: number;
  volume:  number;
}

export interface Trade {
  id:        string;
  symbol:    string;
  direction: "BUY" | "SELL";
  entry:     number;
  sl:        number;
  tp:        number;
  status:    "OPEN" | "WIN" | "LOSS";
  openedAt:  number;
  closedAt?: number;
  pnlPct?:   number;
}

export interface SymbolStatus extends LastData {
  bias:            string;
  tf4h:            string;
  tf1h:            string;
  tf15m:           string;
  tf5m:            string;
  signal:          string;
  confidence:      string;
  entrySignal:     string | null;
  entryPrice:      number | null;
  sl:              number | null;
  tp:              number | null;
  bos:             string | null;
  choch:           string | null;
  liquidity:       string | null;
  hasFVG:          boolean;
  fvgZones:        FVGZone[];
  fvgTouch:        string | null;
  entryState:      string | null;
  luxEvents:       LuxEvent[];
  orderBlocks:     OrderBlock[];
  equalLevels:     EqualLevel[];
  premiumDiscount: PremiumDiscount | null;
}

const lastData           = new Map<string, LastData>();
const lastAlertTime      = new Map<string, number>();
const lastSpikeAlertTime = new Map<string, number>();
const priceHistory       = new Map<string, number[]>();
const symbolStatus       = new Map<string, SymbolStatus>();

const trades: Trade[] = [];
let wins    = 0;
let losses  = 0;
let balance = INITIAL_BALANCE;
const equityHistory: number[] = [];
let lastDigestDay = -1;

// ─── OKX Candle Fetching ────────────────────────────────────────────────────────
// OKX bar codes: 4H, 1H, 15m, 5m, 1m
// Response: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
// Data comes newest-first — must be reversed for chronological order.

export async function getCandles(instId: string, bar: string, limit = 100): Promise<Candle[]> {
  const raw = await getCandlesWithTime(instId, bar, limit);
  return raw.map(({ open, high, low, close }) => ({ open, high, low, close }));
}

export async function getCandlesWithTime(instId: string, bar: string, limit = 100): Promise<CandleWithTime[]> {
  try {
    const res = await fetch(
      `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
    const json = await res.json() as { code: string; data: Array<Array<string>> };
    if (json.code !== "0") throw new Error(`OKX code ${json.code}`);
    return json.data.reverse().map((c) => ({
      time:  Math.floor(Number(c[0]) / 1000),   // ms → seconds
      open:  parseFloat(c[1]),
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  } catch (err) {
    logger.warn({ instId, bar, err }, "OKX candle fetch failed");
    return [];
  }
}

// ─── SMC Engine ────────────────────────────────────────────────────────────────

export function findSwings(candles: Candle[]): Swing[] {
  const swings: Swing[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const p2 = candles[i - 2], p1 = candles[i - 1];
    const c  = candles[i];
    const n1 = candles[i + 1], n2 = candles[i + 2];
    if (c.high > p1.high && c.high > p2.high && c.high > n1.high && c.high > n2.high) {
      swings.push({ type: "HIGH", price: c.high, index: i });
    }
    if (c.low < p1.low && c.low < p2.low && c.low < n1.low && c.low < n2.low) {
      swings.push({ type: "LOW", price: c.low, index: i });
    }
  }
  return swings;
}

export function detectStructure(swings: Swing[]): StructureResult {
  const result: StructureResult = { bos: null, choch: null };
  if (swings.length < 3) return result;
  const last  = swings[swings.length - 1];
  const prev  = swings[swings.length - 2];
  const prev2 = swings[swings.length - 3];
  if (last.type === "HIGH" && last.price > prev.price) result.bos = "BULLISH";
  if (last.type === "LOW"  && last.price < prev.price) result.bos = "BEARISH";
  if (prev2.type === "HIGH" && prev.type === "LOW" && last.type === "HIGH" && last.price > prev2.price) {
    result.choch = "BULLISH";
  }
  if (prev2.type === "LOW" && prev.type === "HIGH" && last.type === "LOW" && last.price < prev2.price) {
    result.choch = "BEARISH";
  }
  return result;
}

export function detectFVG(candles: Candle[]): FVGZone[] {
  const zones: FVGZone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c1.high < c3.low)  zones.push({ type: "BULLISH", top: c3.low,  bottom: c1.high });
    if (c1.low  > c3.high) zones.push({ type: "BEARISH", top: c1.low,  bottom: c3.high });
  }
  return zones.slice(-5);
}

export function detectFVGWithTime(candles: CandleWithTime[]): FVGZoneWithTime[] {
  const zones: FVGZoneWithTime[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];
    if (c1.high < c3.low)  zones.push({ type: "BULLISH", top: c3.low,  bottom: c1.high, time: c2.time });
    if (c1.low  > c3.high) zones.push({ type: "BEARISH", top: c1.low,  bottom: c3.high, time: c2.time });
  }
  return zones.slice(-5);
}

// ─── Liquidity, FVG Touch, Simple Structure ─────────────────────────────────────

function detectLiquidity(candles: Candle[], swings: Swing[]): string | null {
  if (swings.length < 2 || candles.length < 1) return null;
  const lastCandle = candles[candles.length - 1];
  const refSwing   = swings[swings.length - 2];
  if (refSwing.type === "HIGH" && lastCandle.high > refSwing.price) return "BUY_SIDE_LIQUIDITY_TAKEN";
  if (refSwing.type === "LOW"  && lastCandle.low  < refSwing.price) return "SELL_SIDE_LIQUIDITY_TAKEN";
  return null;
}

// Checks if the current price is inside any of the recent FVG zones
function detectFVGTouch(price: number, zones: FVGZone[]): "bullish" | "bearish" | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (price >= z.bottom && price <= z.top) {
      return z.type === "BULLISH" ? "bullish" : "bearish";
    }
  }
  return null;
}

// Simple 2-candle structure check (user's getStructure pattern)
function getSimpleStructure(candles: Candle[]): string {
  if (candles.length < 2) return "RANGE";
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (last.close > prev.high) return "BOS_BULLISH";
  if (last.close < prev.low)  return "BOS_BEARISH";
  return "RANGE";
}

function bosToTrend(bos: string | null, choch: string | null): "bullish" | "bearish" | "neutral" {
  const signal = choch ?? bos;
  if (signal === "BULLISH") return "bullish";
  if (signal === "BEARISH") return "bearish";
  return "neutral";
}

// ─── Full SMC Analysis ────────────────────────────────────────────────────────

async function runSmcAnalysis(instId: string): Promise<SmcAnalysis | null> {
  const [c4h, c1h, c15m, c5m] = await Promise.all([
    getCandles(instId, "4H",  100),
    getCandles(instId, "1H",  100),
    getCandles(instId, "15m", 100),
    getCandles(instId, "5m",  100),
  ]);

  if (!c5m.length) return null;

  const price = c5m[c5m.length - 1].close;

  const swings4h  = findSwings(c4h);
  const swings1h  = findSwings(c1h);
  const swings15m = findSwings(c15m);
  const swings5m  = findSwings(c5m);

  const s4h  = detectStructure(swings4h);
  const s1h  = detectStructure(swings1h);
  const s15m = detectStructure(swings15m);
  const s5m  = detectStructure(swings5m);

  const liquidity       = detectLiquidity(c15m, swings15m);
  const fvgZones        = detectFVG(c15m);
  const fvgTouch        = detectFVGTouch(price, fvgZones);
  const simpleStructure = getSimpleStructure(c5m);

  // ── LuxSMC: OB + EQH/EQL + Events ──────────────────────────────────────────
  // Run on 15m candles for best signal quality (needs open/high/low/close/time)
  const c15mWithTime = await getCandlesWithTime(instId, "15m", 100);
  const lux = detectLuxSMC(c15mWithTime);

  let bias: "BUY" | "SELL" | "NONE" = "NONE";
  if (s4h.bos === "BULLISH" && s1h.bos === "BULLISH") bias = "BUY";
  if (s4h.bos === "BEARISH" && s1h.bos === "BEARISH") bias = "SELL";

  const htfAligned = s4h.bos !== null && s4h.bos === s1h.bos;

  return {
    tf4h:            bosToTrend(s4h.bos, s4h.choch),
    tf1h:            bosToTrend(s1h.bos, s1h.choch),
    tf15m:           bosToTrend(s15m.bos, s15m.choch),
    tf5m:            bosToTrend(s5m.bos, s5m.choch),
    bos:             s5m.bos,
    choch:           s15m.choch,
    liquidity,
    fvgZones,
    hasFVG:          fvgZones.length > 0,
    fvgTouch,
    simpleStructure,
    price,
    bias,
    htfAligned,
    luxEvents:       lux.events,
    orderBlocks:     lux.orderBlocks,
    equalLevels:     lux.equalLevels,
    premiumDiscount: lux.premiumDiscount,
  };
}

// ─── Flow Classifier (OI + Volume + Funding) ──────────────────────────────────

function classifyFlow(
  priceChange: number,
  oiChange:   number,
  volChange:  number,
  funding:    number,
): string {
  if (priceChange > 0 && oiChange > 0.05 && volChange > 0.2)  return "🔥 BULLISH CONTINUATION";
  if (priceChange < 0 && oiChange > 0.05 && volChange < -0.2) return "🔥 BEARISH CONTINUATION";
  if (priceChange > 0 && oiChange < 0)                         return "🚀 SHORT SQUEEZE";
  if (priceChange < 0 && oiChange < 0)                         return "💥 LONG SQUEEZE";
  if (priceChange > 0 && oiChange > 0 && funding > 0.02)       return "🐂 BULL TRAP";
  if (priceChange < 0 && oiChange > 0 && funding < -0.02)      return "🐻 BEAR TRAP";
  if (Math.abs(priceChange) < 0.005 && oiChange > 0) {
    return volChange > 0 ? "🟢 ACCUMULATION" : "🔴 DISTRIBUTION";
  }
  return "⚖️ NO CLEAR DIRECTION";
}

// ─── Confidence ──────────────────────────────────────────────────────────────

function getConfidence(
  smc:         SmcAnalysis,
  flow:        string,
  priceChange: number,
): "LOW" | "MEDIUM" | "HIGH" {
  let score = 0;
  if (smc.htfAligned)              score += 2;
  if (smc.choch !== null)          score += 2;
  if (smc.liquidity !== null)      score += 1;
  if (smc.hasFVG)                  score += 1;
  if (smc.bos !== null)            score += 1;
  if (smc.fvgTouch !== null)       score += 1;
  if (!flow.includes("NO CLEAR"))  score += 1;
  if (Math.abs(priceChange) > 0.01) score += 1;
  if (score >= 6) return "HIGH";
  if (score >= 3) return "MEDIUM";
  return "LOW";
}

// ─── Two-Stage Entry Signal (user's pattern) ──────────────────────────────────
//
// Stage 1 — getEntrySignal:
//   Returns "BUY", "SELL_WAIT", or null
//   SELL_WAIT fires when bearish bias is confirmed but 5m BOS hasn't broken down yet
//
// Stage 2 — confirmEntry:
//   Promotes "SELL_WAIT" → "SELL" once 5m simple structure shows BOS_BEARISH

function getEntrySignal(
  smc:        SmcAnalysis,
  confidence: string,
  flow:       string,
): "BUY" | "SELL_WAIT" | null {
  if (confidence === "LOW")   return null;
  if (flow.includes("TRAP"))  return null;

  // HTF (1h) and 15m must agree — if not, WAIT
  if (smc.tf1h !== smc.tf15m) return null;

  // BUY: HTF bullish + CHoCH + (FVG touch OR near order block) + volume confirmation
  const bullishVolume = flow.includes("BULLISH") || flow.includes("ACCUMULATION") || flow.includes("SQUEEZE");
  if (
    smc.bias === "BUY" &&
    smc.htfAligned &&
    smc.choch === "BULLISH" &&
    (smc.fvgTouch === "bullish" || smc.liquidity === "SELL_SIDE_LIQUIDITY_TAKEN") &&
    bullishVolume
  ) return "BUY";

  // SELL_WAIT: bearish bias + CHoCH + (FVG touch OR liquidity taken) + bearish flow
  const bearishVolume = flow.includes("BEARISH") || flow.includes("DISTRIBUTION") || flow.includes("SHORT SQUEEZE");
  if (
    smc.bias === "SELL" &&
    smc.choch === "BEARISH" &&
    (smc.fvgTouch === "bearish" || smc.liquidity === "BUY_SIDE_LIQUIDITY_TAKEN") &&
    bearishVolume
  ) return "SELL_WAIT";

  return null;
}

function confirmEntry(
  raw:       "BUY" | "SELL_WAIT" | null,
  structure: string,
): "BUY" | "SELL" | null {
  if (raw === "BUY") return "BUY";
  if (raw === "SELL_WAIT" && structure === "BOS_BEARISH") return "SELL";
  return null;
}

function getBiasLabel(bias: "BUY" | "SELL" | "NONE"): string {
  if (bias === "BUY")  return "🟢 BULLISH";
  if (bias === "SELL") return "🔴 BEARISH";
  return "⚖️ NEUTRAL";
}

// ─── OKX Primary Fetch ────────────────────────────────────────────────────────

async function fetchOkxPrimary(cfg: SymbolConfig): Promise<OkxPrimary | null> {
  try {
    const [tickerRes, fundingRes, oiRes] = await Promise.all([
      fetch(`https://www.okx.com/api/v5/market/ticker?instId=${cfg.okxInstId}`),
      fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${cfg.okxInstId}`),
      fetch(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${cfg.okxCcy}&period=5m`),
    ]);
    const tj = await tickerRes.json()  as { code: string; data: Array<{ last: string; volCcy24h: string }> };
    const fj = await fundingRes.json() as { code: string; data: Array<{ fundingRate: string }> };
    const oj = await oiRes.json()      as { code: string; data: Array<[string, string, string]> };
    if (tj.code !== "0" || fj.code !== "0" || oj.code !== "0") return null;
    return {
      price:   Number(tj.data[0]?.last),
      volume:  Number(tj.data[0]?.volCcy24h),
      funding: Number(fj.data[0]?.fundingRate),
      oi:      Number(oj.data[0]?.[1]),
    };
  } catch (err) {
    logger.warn({ symbol: cfg.okxInstId, err }, "OKX fetch failed");
    return null;
  }
}

async function fetchCoinGeckoPrice(coinIds: string[]): Promise<Record<string, number>> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as Record<string, { usd: number }>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.usd]));
  } catch (err) {
    logger.warn({ err }, "CoinGecko validation fetch failed");
    return {};
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "Telegram message failed");
  }
}

// ─── Trade Management ─────────────────────────────────────────────────────────

function activeSession(): string | null {
  const h = new Date().getUTCHours();
  for (const s of SESSIONS) if (h >= s.startHour && h < s.endHour) return s.name;
  return null;
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function getDirection(current: number, previous: number): string {
  if (current > previous) return "📈 Up";
  if (current < previous) return "📉 Down";
  return "➡️ Flat";
}

function calculateRiskReward(price: number, direction: "BUY" | "SELL") {
  if (direction === "BUY") {
    return { entry: price, sl: price * (1 - RISK_PER_TRADE), tp: price * (1 + RISK_PER_TRADE * REWARD_MULTIPLIER) };
  }
  return { entry: price, sl: price * (1 + RISK_PER_TRADE), tp: price * (1 - RISK_PER_TRADE * REWARD_MULTIPLIER) };
}

function hasOpenTrade(symbol: string): boolean {
  return trades.some((t) => t.symbol === symbol && t.status === "OPEN");
}

function openTrade(symbol: string, direction: "BUY" | "SELL", entry: number, sl: number, tp: number): Trade {
  const trade: Trade = {
    id: `${symbol}-${Date.now()}`,
    symbol, direction, entry, sl, tp,
    status: "OPEN",
    openedAt: Date.now(),
  };
  trades.push(trade);
  void dbSaveTrade(trade);
  return trade;
}

function checkAndCloseTrades(symbol: string, currentPrice: number): Trade[] {
  const closed: Trade[] = [];
  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.status !== "OPEN") continue;
    const { direction, entry, sl, tp } = trade;
    if (direction === "BUY") {
      if (currentPrice <= sl)      { trade.status = "LOSS"; trade.closedAt = Date.now(); trade.pnlPct = (currentPrice - entry) / entry; closed.push(trade); }
      else if (currentPrice >= tp) { trade.status = "WIN";  trade.closedAt = Date.now(); trade.pnlPct = (currentPrice - entry) / entry; closed.push(trade); }
    } else {
      if (currentPrice >= sl)      { trade.status = "LOSS"; trade.closedAt = Date.now(); trade.pnlPct = (entry - currentPrice) / entry; closed.push(trade); }
      else if (currentPrice <= tp) { trade.status = "WIN";  trade.closedAt = Date.now(); trade.pnlPct = (entry - currentPrice) / entry; closed.push(trade); }
    }
  }
  for (const ct of closed) {
    void dbSaveTrade(ct);
  }
  return closed;
}

function updatePerformance(closed: Trade[]): void {
  for (const trade of closed) {
    if (trade.status === "WIN")  { wins++;   balance += balance * (RISK_PER_TRADE * REWARD_MULTIPLIER); }
    if (trade.status === "LOSS") { losses++; balance -= balance * RISK_PER_TRADE; }
    equityHistory.push(balance);
    logger.info({ symbol: trade.symbol, status: trade.status, balance: balance.toFixed(2) }, "Trade closed");
    void dbSaveEquitySnapshot({ balance, wins, losses });
  }
}

function getWinRate(): number {
  const total = wins + losses;
  return total > 0 ? (wins / total) * 100 : 0;
}

// ─── Main Check Loop ──────────────────────────────────────────────────────────

async function sendDailyDigest(botToken: string, chatId: string): Promise<void> {
  const now = new Date();
  const day = now.getUTCDate();
  const hour = now.getUTCHours();

  if (hour !== 9 || day === lastDigestDay) return;
  lastDigestDay = day;

  const lines: string[] = [];
  lines.push(`📊 <b>Daily Market Digest — ${now.toUTCString().slice(0, 16)}</b>\n`);

  for (const cfg of SYMBOLS) {
    const data = symbolStatus.get(cfg.symbol);
    if (!data) { lines.push(`${cfg.displayName}: no data`); continue; }
    const price = data.priceOkx;
    const priceStr = price < 10 ? price.toFixed(4) : price < 1000 ? price.toFixed(2) : price.toFixed(1);
    const bias = data.bias ?? "⚖️ NEUTRAL";
    const fundingPct = (data.funding * 100).toFixed(4);
    lines.push(`<b>${cfg.displayName}</b>: $${priceStr}  ${bias}  Funding: ${fundingPct}%`);
  }

  const perf = { wins, losses, balance };
  const winRateStr = perf.wins + perf.losses > 0
    ? ((perf.wins / (perf.wins + perf.losses)) * 100).toFixed(1) + "%"
    : "N/A";
  lines.push(`\n<b>Paper Trading</b>: Balance $${perf.balance.toFixed(2)}  W:${perf.wins} L:${perf.losses}  Win-rate: ${winRateStr}`);
  lines.push(`\n<i>Monitoring: BTC • ETH • SOL • BNB • XRP every 2 min</i>`);

  await sendTelegramMessage(botToken, chatId, lines.join("\n"));
  logger.info("Daily digest sent");
}

async function runCheck(botToken: string, chatId: string): Promise<void> {
  const session = activeSession();
  const coinIds = SYMBOLS.map((s) => s.coinId);

  const [cgPrices, ...okxResults] = await Promise.all([
    fetchCoinGeckoPrice(coinIds),
    ...SYMBOLS.map((s) => fetchOkxPrimary(s)),
  ]);

  for (let i = 0; i < SYMBOLS.length; i++) {
    const cfg = SYMBOLS[i];
    const okx = okxResults[i] as OkxPrimary | null;

    try {
      if (!okx) {
        logger.warn({ symbol: cfg.symbol }, "OKX data unavailable — skipping");
        continue;
      }

      const priceOkx = okx.price;
      const priceCg  = cgPrices[cfg.coinId] ?? 0;

      if (priceCg > 0) {
        const priceDiff = Math.abs(priceOkx - priceCg) / priceOkx;
        // Use a looser threshold for low-price coins (< $10) since CoinGecko updates less frequently
        const divergenceThreshold = priceOkx < 10 ? 0.008 : 0.003;
        if (priceDiff > divergenceThreshold) {
          logger.warn({ symbol: cfg.symbol, priceOkx, priceCg }, "Price divergence — skipping cycle");
          continue;
        }
      }

      const { oi, funding, volume } = okx;

      const history = priceHistory.get(cfg.symbol) ?? [];
      history.push(priceOkx);
      if (history.length > PRICE_HISTORY_SIZE) history.shift();
      priceHistory.set(cfg.symbol, history);

      logger.info({ symbol: cfg.symbol, priceOkx, priceCg, oi, funding, volume, session }, "Checked symbol");

      const prev = lastData.get(cfg.symbol);
      if (!prev) {
        lastData.set(cfg.symbol, { priceOkx, priceCg, oi, volume, funding });
        symbolStatus.set(cfg.symbol, {
          priceOkx, priceCg, oi, volume, funding,
          bias: "⚖️ NEUTRAL",
          tf4h: "neutral", tf1h: "neutral", tf15m: "neutral", tf5m: "neutral",
          signal: "⚖️ LOADING DATA...",
          confidence: "LOW",
          entrySignal: null, entryPrice: null, sl: null, tp: null,
          bos: null, choch: null, liquidity: null,
          hasFVG: false, fvgZones: [], fvgTouch: null, entryState: null,
          luxEvents: [], orderBlocks: [], equalLevels: [], premiumDiscount: null,
        });
        continue;
      }

      const priceChange = (priceOkx - prev.priceOkx) / prev.priceOkx;
      const oiChange    = prev.oi     > 0 ? (oi     - prev.oi)     / prev.oi     : 0;
      const volChange   = prev.volume > 0 ? (volume - prev.volume) / prev.volume : 0;

      // ── Price Spike Alert (>= 2% move in one cycle) ─────────────────────────
      const SPIKE_THRESHOLD = 0.02;
      const SPIKE_COOLDOWN  = 15 * 60 * 1000; // 15 min between spike alerts per symbol
      const nowSpike = Date.now();
      const lastSpike = lastSpikeAlertTime.get(cfg.symbol) ?? 0;
      if (Math.abs(priceChange) >= SPIKE_THRESHOLD && botToken && chatId && nowSpike - lastSpike > SPIKE_COOLDOWN) {
        const dir     = priceChange > 0 ? "🚀 PUMP" : "💣 DUMP";
        const arrow   = priceChange > 0 ? "▲" : "▼";
        const spikeMsg =
          `⚡ <b>PRICE SPIKE — ${cfg.displayName}/USDT</b>\n\n` +
          `${dir}  ${arrow} ${pct(priceChange)} in 2 min\n` +
          `Price: $${priceOkx.toFixed(priceOkx < 10 ? 4 : 2)}\n` +
          `OI Change: ${pct(oiChange)}  |  Funding: ${(funding * 100).toFixed(4)}%`;
        await sendTelegramMessage(botToken, chatId, spikeMsg);
        lastSpikeAlertTime.set(cfg.symbol, nowSpike);
        logger.info({ symbol: cfg.symbol, priceChange }, "Price spike alert sent");
      }

      // ── Real SMC Analysis (OKX candles) ────────────────────────────────────
      const smc = await runSmcAnalysis(cfg.okxInstId);
      if (!smc) {
        logger.warn({ symbol: cfg.symbol }, "Candle fetch failed — skipping SMC analysis");
        lastData.set(cfg.symbol, { priceOkx, priceCg, oi, volume, funding });
        continue;
      }

      // ── Flow Classification ─────────────────────────────────────────────────
      const flow       = classifyFlow(priceChange, oiChange, volChange, funding);
      const confidence = getConfidence(smc, flow, priceChange);
      const biasLabel  = getBiasLabel(smc.bias);

      // ── Two-Stage Entry ─────────────────────────────────────────────────────
      const rawSignal      = hasOpenTrade(cfg.symbol) ? null : getEntrySignal(smc, confidence, flow);
      const entryDirection = confirmEntry(rawSignal, smc.simpleStructure);

      // ── Persist Signal to DB ────────────────────────────────────────────────
      void dbSaveSignal({
        symbol:        cfg.symbol,
        direction:     entryDirection ?? rawSignal ?? "WAIT",
        confidence,
        flow,
        bias:          smc.bias,
        bos:           smc.bos,
        choch:         smc.choch,
        liquidity:     smc.liquidity,
        hasFvg:        smc.hasFVG,
        fvgTouch:      smc.fvgTouch,
        tf4h:          smc.tf4h,
        tf1h:          smc.tf1h,
        tf15m:         smc.tf15m,
        tf5m:          smc.tf5m,
        priceAtSignal: smc.price,
      });

      // ── Trade Management ────────────────────────────────────────────────────
      const closedTrades = checkAndCloseTrades(cfg.symbol, priceOkx);
      updatePerformance(closedTrades);

      for (const ct of closedTrades) {
        const emoji = ct.status === "WIN" ? "✅" : "❌";
        await sendTelegramMessage(botToken, chatId,
          `${emoji} <b>TRADE CLOSED — ${ct.symbol}</b>\n` +
          `Direction: ${ct.direction}  |  Result: ${ct.status}\n` +
          `Entry: $${ct.entry.toFixed(2)}  →  Close: $${priceOkx.toFixed(2)}\n` +
          `PnL: ${ct.pnlPct !== undefined ? pct(ct.pnlPct) : "N/A"}\n\n` +
          `📊 Win Rate: ${getWinRate().toFixed(1)}%  |  Balance: $${balance.toFixed(2)}`
        );
      }

      let newTrade: Trade | null = null;
      if (entryDirection) {
        const { entry, sl, tp } = calculateRiskReward(priceOkx, entryDirection);
        newTrade = openTrade(cfg.symbol, entryDirection, entry, sl, tp);
        logger.info({ symbol: cfg.symbol, direction: entryDirection, entry, sl, tp }, "Trade opened");
      }

      symbolStatus.set(cfg.symbol, {
        priceOkx, priceCg, oi, volume, funding,
        bias:            biasLabel,
        tf4h:            smc.tf4h,
        tf1h:            smc.tf1h,
        tf15m:           smc.tf15m,
        tf5m:            smc.tf5m,
        signal:          flow,
        confidence,
        entrySignal:     newTrade?.direction ?? null,
        entryPrice:      newTrade?.entry     ?? null,
        sl:              newTrade?.sl        ?? null,
        tp:              newTrade?.tp        ?? null,
        bos:             smc.bos,
        choch:           smc.choch,
        liquidity:       smc.liquidity,
        hasFVG:          smc.hasFVG,
        fvgZones:        smc.fvgZones,
        fvgTouch:        smc.fvgTouch,
        entryState:      rawSignal,
        luxEvents:       smc.luxEvents,
        orderBlocks:     smc.orderBlocks,
        equalLevels:     smc.equalLevels,
        premiumDiscount: smc.premiumDiscount,
      });

      // ── Alert Cooldown ──────────────────────────────────────────────────────
      const now  = Date.now();
      const last = lastAlertTime.get(cfg.symbol) ?? 0;
      if (now - last < 5 * 60 * 1000) {
        const secs = Math.round((5 * 60 * 1000 - (now - last)) / 1000);
        logger.info({ symbol: cfg.symbol, cooldownRemaining: secs }, "Alert suppressed (cooldown)");
        lastData.set(cfg.symbol, { priceOkx, priceCg, oi, volume, funding });
        continue;
      }

      if (flow === "⚖️ NO CLEAR DIRECTION" && !newTrade) {
        lastData.set(cfg.symbol, { priceOkx, priceCg, oi, volume, funding });
        continue;
      }

      // ── Telegram Alert ──────────────────────────────────────────────────────
      const sessionLine = session ? `🕐 <b>${session} Session</b>\n` : "";

      // Market Intelligence: event-based alerts from LuxSMC
      const luxMsg = buildMarketIntelligenceMessage(
        `${cfg.displayName}/USDT`,
        priceOkx,
        { events: smc.luxEvents, orderBlocks: smc.orderBlocks, equalLevels: smc.equalLevels, fvgZones: smc.fvgZones, premiumDiscount: smc.premiumDiscount },
      );

      const tfBlock =
        `\n📊 <b>TIMEFRAMES</b>  4H: ${smc.tf4h.toUpperCase()}  1H: ${smc.tf1h.toUpperCase()}  15m: ${smc.tf15m.toUpperCase()}  5m: ${smc.tf5m.toUpperCase()}`;

      const flowBlock =
        `\n⚡ <b>FLOW:</b> ${flow}` +
        `  |  Price: ${getDirection(priceOkx, prev.priceOkx)} (${pct(priceChange)})` +
        `  |  OI: ${getDirection(oi, prev.oi)} (${pct(oiChange)})` +
        `  |  Funding: ${(funding * 100).toFixed(3)}%`;

      const tradeBlock = newTrade
        ? `\n\n🎯 <b>ENTRY SIGNAL: ${newTrade.direction}</b>\n` +
          `  Entry: $${newTrade.entry.toFixed(2)}  |  SL: $${newTrade.sl.toFixed(2)}  |  TP: $${newTrade.tp.toFixed(2)}`
        : rawSignal === "SELL_WAIT"
          ? `\n\n⏳ <b>SELL_WAIT</b> — awaiting 5m BOS confirmation`
          : "";

      const perfBlock = `\n\n📈 W: ${wins}  L: ${losses}  WR: ${getWinRate().toFixed(1)}%`;

      const message = sessionLine + luxMsg + tfBlock + flowBlock + tradeBlock + perfBlock;

      await sendTelegramMessage(botToken, chatId, message);
      lastAlertTime.set(cfg.symbol, now);
      logger.info({
        symbol: cfg.symbol, flow, confidence,
        bos: smc.bos, choch: smc.choch,
        fvgTouch: smc.fvgTouch, rawSignal, entryDirection,
      }, "Alert sent");

      lastData.set(cfg.symbol, { priceOkx, priceCg, oi, volume, funding });
    } catch (err) {
      logger.error({ symbol: cfg.symbol, err }, "Error checking symbol");
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startCryptoMonitor(): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — running in monitor-only mode (no Telegram alerts)");
  }

  logger.info("Starting crypto monitor (Real SMC Engine v2)...");

  const effectiveToken = botToken ?? "";
  const effectiveChatId = chatId ?? "";

  const init = async () => {
    // Restore open trades from DB on startup
    try {
      const openTrades = await dbLoadOpenTrades();
      for (const t of openTrades) {
        if (!trades.find((x) => x.id === t.id)) {
          trades.push({ ...t, closedAt: undefined, pnlPct: undefined });
        }
      }
      logger.info({ count: openTrades.length }, "Restored open trades from DB");
    } catch (err) {
      logger.warn({ err }, "Could not restore open trades from DB");
    }

    // Restore equity state from DB on startup
    try {
      const equity = await dbLoadLatestEquity();
      if (equity) {
        balance = equity.balance;
        wins    = equity.wins;
        losses  = equity.losses;
        logger.info({ balance, wins, losses }, "Restored equity state from DB");
      }
    } catch (err) {
      logger.warn({ err }, "Could not restore equity state from DB");
    }

    const tick = async () => {
      try {
        if (effectiveToken && effectiveChatId) {
          await runCheck(effectiveToken, effectiveChatId);
          await sendDailyDigest(effectiveToken, effectiveChatId);
        } else {
          await runCheck("", "");
        }
      } catch (err) {
        logger.error({ err }, "Unexpected error in crypto monitor tick");
      }
      setTimeout(tick, 120_000);
    };

    void tick();
  };

  void init();
}

export function getMonitorStatus() {
  const openTrades   = trades.filter((t) => t.status === "OPEN");
  const recentTrades = trades
    .filter((t) => t.status !== "OPEN")
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    .slice(0, 20);

  return {
    symbols:      SYMBOLS.map((s) => s.symbol),
    lastData:     Object.fromEntries(lastData.entries()),
    symbolStatus: Object.fromEntries(symbolStatus.entries()),
    performance: {
      wins, losses,
      winRate: getWinRate(),
      balance,
      initialBalance: INITIAL_BALANCE,
      equityHistory:  equityHistory.slice(-50),
    },
    openTrades,
    recentTrades,
  };
}
