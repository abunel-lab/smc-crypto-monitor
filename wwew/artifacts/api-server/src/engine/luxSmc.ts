// ─── SmartFlow SMC Engine ─────────────────────────────────────────────────────
// Ported from SmartFlow SMC Pine Script (v6) — © SmartFlow2026
// Logic: symmetric pivot detection, EMA200-biased trend init,
//        tracking-extreme BoS targets, MSS reversal, BSL/SSL,
//        sweep detection, ATR-filtered order blocks, FVG, EQH/EQL.

export interface Candle {
  time:  number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

export type LuxEventType =
  | "FVG_BULLISH"
  | "FVG_BEARISH"
  | "BOS_BULLISH"
  | "BOS_BEARISH"
  | "CHOCH_BULLISH"
  | "CHOCH_BEARISH"
  | "OB_BULLISH"
  | "OB_BEARISH"
  | "EQH"
  | "EQL"
  | "SWEEP_BULLISH"
  | "SWEEP_BEARISH";

export interface LuxEvent {
  type:    LuxEventType;
  price?:  number;
  top?:    number;
  bottom?: number;
  time:    number;
  label:   string;
}

export interface OrderBlock {
  type:   "BULLISH" | "BEARISH";
  top:    number;
  bottom: number;
  time:   number;
  broken: boolean;
}

export interface EqualLevel {
  type:  "EQH" | "EQL";
  price: number;
  time:  number;
}

export interface PremiumDiscount {
  zone:      "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  mid:       number;
  rangeHigh: number;
  rangeLow:  number;
}

export interface LuxSmcResult {
  events:          LuxEvent[];
  orderBlocks:     OrderBlock[];
  equalLevels:     EqualLevel[];
  premiumDiscount: PremiumDiscount;
  fvgZones:        Array<{ type: "BULLISH" | "BEARISH"; top: number; bottom: number; time: number }>;
  bslLevel?:       number;   // Buy-Side Liquidity (latest swing high)
  sslLevel?:       number;   // Sell-Side Liquidity (latest swing low)
  trend?:          number;   // 1 = bullish, -1 = bearish
  ema200?:         number;   // last EMA200 value
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BULLISH = 1;
const BEARISH = -1;

// ─── EMA200 ───────────────────────────────────────────────────────────────────

function calcEMA(candles: Candle[], period: number): number[] {
  const k    = 2 / (period + 1);
  const emas = new Array<number>(candles.length);
  emas[0]    = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    emas[i] = candles[i].close * k + emas[i - 1] * (1 - k);
  }
  return emas;
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

function calcATR(candles: Candle[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h  = candles[i].high;
    const l  = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  if (!slice.length) return 1;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ─── Volatility-filtered bars (for OB quality) ───────────────────────────────
// High-vol bars (range >= 2×ATR): swap high/low before OB search.

function buildFilteredBars(
  candles: Candle[],
  atr:     number,
): { parsedHighs: number[]; parsedLows: number[] } {
  const parsedHighs: number[] = [];
  const parsedLows:  number[] = [];
  for (const c of candles) {
    const highVol = (c.high - c.low) >= 2 * atr;
    parsedHighs.push(highVol ? c.low  : c.high);
    parsedLows.push( highVol ? c.high : c.low);
  }
  return { parsedHighs, parsedLows };
}

// ─── Symmetric Pivot Detection (ta.pivothigh / ta.pivotlow) ──────────────────
// A pivot high at bar i: candles[i].high is strictly greater than all bars
// within lb on each side.

function isPivotHigh(candles: Candle[], i: number, lb: number): boolean {
  if (i < lb || i + lb >= candles.length) return false;
  const h = candles[i].high;
  for (let j = i - lb; j <= i + lb; j++) {
    if (j === i) continue;
    if (candles[j].high >= h) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], i: number, lb: number): boolean {
  if (i < lb || i + lb >= candles.length) return false;
  const l = candles[i].low;
  for (let j = i - lb; j <= i + lb; j++) {
    if (j === i) continue;
    if (candles[j].low <= l) return false;
  }
  return true;
}

// ─── Order Block finder ───────────────────────────────────────────────────────
// Bullish OB: bar with minimum parsedLow in range (best low before breakout).
// Bearish OB: bar with maximum parsedHigh in range.

function findOrderBlock(
  candles:      Candle[],
  parsedHighs:  number[],
  parsedLows:   number[],
  fromIdx:      number,
  toIdx:        number,
  bias:         number,
  currentPrice: number,
): OrderBlock | null {
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(candles.length - 1, toIdx);
  if (lo > hi) return null;

  let bestIdx = lo;
  if (bias === BULLISH) {
    let minVal = Infinity;
    for (let i = lo; i <= hi; i++) {
      if (parsedLows[i] < minVal) { minVal = parsedLows[i]; bestIdx = i; }
    }
  } else {
    let maxVal = -Infinity;
    for (let i = lo; i <= hi; i++) {
      if (parsedHighs[i] > maxVal) { maxVal = parsedHighs[i]; bestIdx = i; }
    }
  }

  const c      = candles[bestIdx];
  const broken = bias === BULLISH ? currentPrice < c.low : currentPrice > c.high;

  return {
    type:   bias === BULLISH ? "BULLISH" : "BEARISH",
    top:    c.high,
    bottom: c.low,
    time:   c.time,
    broken,
  };
}

// ─── SmartFlow Structure Engine (BoS / MSS) ───────────────────────────────────
// Mirrors the Pine Script state machine:
//   - trend initialised from EMA200
//   - tracking extreme is maintained after each BoS to improve next target
//   - MSS fires when opposite structure is broken → trend reversal

interface StructureState {
  events:      LuxEvent[];
  orderBlocks: OrderBlock[];
  trend:       number;
  bslLevel:    number | null;
  sslLevel:    number | null;
  trailingHigh: number;
  trailingLow:  number;
}

function detectSmartFlowStructure(
  candles:     Candle[],
  emas:        number[],
  parsedHighs: number[],
  parsedLows:  number[],
  lb:          number,
): StructureState {
  const events:      LuxEvent[]   = [];
  const orderBlocks: OrderBlock[] = [];
  const price = candles[candles.length - 1].close;

  // Pre-compute pivot locations (requires lb bars on each side)
  const isPhAt = new Array<boolean>(candles.length).fill(false);
  const isPlAt = new Array<boolean>(candles.length).fill(false);
  for (let i = lb; i < candles.length - lb; i++) {
    if (isPivotHigh(candles, i, lb)) isPhAt[i] = true;
    if (isPivotLow(candles, i, lb))  isPlAt[i] = true;
  }

  let trend      = 0;
  let bosTarget: number | null = null;
  let bosBar     = -1;
  let mssLevel: number | null = null;
  let bossBroken = true;

  let trackHi    = -Infinity;
  let trackHiBar = -1;
  let trackLo    =  Infinity;
  let trackLoBar = -1;

  // Latest confirmed pivot high/low (for BSL/SSL and MSS reset)
  let pvHi: number | null = null;
  let pvHiBar              = -1;
  let pvLo: number | null = null;
  let pvLoBar              = -1;

  let pvHiPrev: number | null = null;
  let pvHiPrevBar              = -1;
  let pvLoPrev: number | null = null;
  let pvLoPrevBar              = -1;

  let trailingHigh = -Infinity;
  let trailingLow  =  Infinity;

  for (let i = 0; i < candles.length; i++) {
    const c         = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const prevHigh  = i > 0 ? candles[i - 1].high  : c.high;
    const prevLow   = i > 0 ? candles[i - 1].low   : c.low;

    trailingHigh = Math.max(trailingHigh, c.high);
    trailingLow  = Math.min(trailingLow,  c.low);

    // ── Pivot confirmation: the pivot at (i - lb) is now confirmed ───────────
    const confirmedIdx = i - lb;
    let newPh = false;
    let newPl = false;
    if (confirmedIdx >= 0) {
      if (isPhAt[confirmedIdx]) {
        pvHiPrev    = pvHi;    pvHiPrevBar = pvHiBar;
        pvHi        = candles[confirmedIdx].high;
        pvHiBar     = confirmedIdx;
        newPh       = true;
      }
      if (isPlAt[confirmedIdx]) {
        pvLoPrev    = pvLo;    pvLoPrevBar = pvLoBar;
        pvLo        = candles[confirmedIdx].low;
        pvLoBar     = confirmedIdx;
        newPl       = true;
      }
    }

    // ── Trend initialisation (first bar only) ─────────────────────────────────
    if (trend === 0) {
      trend      = c.close > emas[i] ? 1 : -1;
      bossBroken = true;
      trackHi    = prevHigh; trackHiBar = Math.max(0, i - 1);
      trackLo    = prevLow;  trackLoBar = Math.max(0, i - 1);
    }

    // ── Tracking extreme update (after each confirmed BoS) ────────────────────
    if (bossBroken) {
      if (prevHigh > trackHi) { trackHi = prevHigh; trackHiBar = i - 1; }
      if (prevLow  < trackLo) { trackLo = prevLow;  trackLoBar = i - 1; }
    }

    // ── Update BoS targets when a new pivot in trend direction is confirmed ───
    if (trend === 1 && newPh && pvHi !== null) {
      // Best target: max of pivot and tracking high
      if (trackHi > -Infinity && trackHi > pvHi) {
        bosTarget = trackHi; bosBar = trackHiBar;
      } else {
        bosTarget = pvHi; bosBar = pvHiBar;
      }
      bossBroken = false;
      trackHi    = -Infinity; trackHiBar = -1;
      trackLo    = prevLow;   trackLoBar = Math.max(0, i - 1);
    }
    if (trend === 1 && newPl && pvLo !== null) {
      mssLevel = pvLo;
    }

    if (trend === -1 && newPl && pvLo !== null) {
      if (trackLo < Infinity && trackLo < pvLo) {
        bosTarget = trackLo; bosBar = trackLoBar;
      } else {
        bosTarget = pvLo; bosBar = pvLoBar;
      }
      bossBroken = false;
      trackLo    = Infinity; trackLoBar = -1;
      trackHi    = prevHigh; trackHiBar = Math.max(0, i - 1);
    }
    if (trend === -1 && newPh && pvHi !== null) {
      mssLevel = pvHi;
    }

    let bosFiredThisBar = false;
    let mssFiredThisBar = false;

    // ── Bullish BoS ───────────────────────────────────────────────────────────
    if (
      trend === 1 &&
      !bossBroken &&
      bosTarget !== null &&
      prevClose > bosTarget
    ) {
      bosFiredThisBar = true;
      events.push({ type: "BOS_BULLISH", price: bosTarget, time: c.time, label: "📈 Bullish BoS" });
      const ob = findOrderBlock(candles, parsedHighs, parsedLows, bosBar, i - 1, BULLISH, price);
      if (ob) orderBlocks.push(ob);
      bossBroken = true;
      trackHi = prevHigh; trackHiBar = i - 1;
      trackLo = prevLow;  trackLoBar = i - 1;
    }

    // ── Bearish BoS ───────────────────────────────────────────────────────────
    if (
      trend === -1 &&
      !bossBroken &&
      bosTarget !== null &&
      prevClose < bosTarget
    ) {
      bosFiredThisBar = true;
      events.push({ type: "BOS_BEARISH", price: bosTarget, time: c.time, label: "📉 Bearish BoS" });
      const ob = findOrderBlock(candles, parsedHighs, parsedLows, bosBar, i - 1, BEARISH, price);
      if (ob) orderBlocks.push(ob);
      bossBroken = true;
      trackLo = prevLow;  trackLoBar = i - 1;
      trackHi = prevHigh; trackHiBar = i - 1;
    }

    // ── Bearish MSS (trend reversal: bull → bear) ─────────────────────────────
    if (
      trend === 1 &&
      mssLevel !== null &&
      !bosFiredThisBar &&
      prevClose < mssLevel
    ) {
      mssFiredThisBar = true;
      events.push({ type: "CHOCH_BEARISH", price: mssLevel, time: c.time, label: "🔄 Bearish MSS (reversal)" });
      trend      = -1;
      bossBroken = true;
      if (pvLo !== null) { bosTarget = pvLo; bosBar = pvLoBar; bossBroken = false; }
      if (pvHi !== null)   mssLevel = pvHi;
    }

    // ── Bullish MSS (trend reversal: bear → bull) ─────────────────────────────
    if (
      trend === -1 &&
      mssLevel !== null &&
      !bosFiredThisBar &&
      !mssFiredThisBar &&
      prevClose > mssLevel
    ) {
      events.push({ type: "CHOCH_BULLISH", price: mssLevel, time: c.time, label: "🔄 Bullish MSS (reversal)" });
      trend      = 1;
      bossBroken = true;
      if (pvHi !== null) { bosTarget = pvHi; bosBar = pvHiBar; bossBroken = false; }
      if (pvLo !== null)   mssLevel = pvLo;
    }
  }

  // ── Sweep detection at the last bar ──────────────────────────────────────────
  const last = candles[candles.length - 1];
  if (pvLo !== null && last.low < pvLo && last.close > pvLo && last.open > pvLo) {
    events.push({ type: "SWEEP_BULLISH", price: pvLo, time: last.time, label: "🌊 Sweep below SSL (bullish)" });
  }
  if (pvHi !== null && last.high > pvHi && last.close < pvHi && last.open < pvHi) {
    events.push({ type: "SWEEP_BEARISH", price: pvHi, time: last.time, label: "🌊 Sweep above BSL (bearish)" });
  }

  return {
    events,
    orderBlocks,
    trend,
    bslLevel:    pvHi,
    sslLevel:    pvLo,
    trailingHigh,
    trailingLow,
  };
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────

function detectFVG(candles: Candle[]): LuxSmcResult["fvgZones"] {
  const zones: LuxSmcResult["fvgZones"] = [];

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    if (c3.low > c1.high && c2.close > c1.high) {
      zones.push({ type: "BULLISH", top: c3.low,  bottom: c1.high, time: c2.time });
    }
    if (c3.high < c1.low && c2.close < c1.low) {
      zones.push({ type: "BEARISH", top: c1.low,  bottom: c3.high, time: c2.time });
    }
  }

  const price = candles[candles.length - 1].close;
  return zones
    .filter(z => z.type === "BULLISH" ? price > z.bottom : price < z.top)
    .slice(-8);
}

// ─── Equal Highs / Lows (percentage tolerance, matching Pine Script) ──────────
// Uses the same symmetric lb-bar pivots; tolerance is a % of the pivot price.

function detectEqualLevels(
  candles:   Candle[],
  lb:        number,
  tolPct     = 0.05,   // 0.05 % default (eq_tolerance in Pine = 0.05)
): EqualLevel[] {
  const levels: EqualLevel[] = [];

  let pvHi: number | null = null;
  let pvHiPrev: number | null = null;
  let pvLo: number | null = null;
  let pvLoPrev: number | null = null;

  for (let i = lb; i < candles.length - lb; i++) {
    if (isPivotHigh(candles, i, lb)) {
      pvHiPrev = pvHi;
      pvHi     = candles[i].high;

      if (pvHiPrev !== null) {
        const tol = pvHiPrev * tolPct / 100;
        if (Math.abs(pvHi - pvHiPrev) <= tol) {
          levels.push({ type: "EQH", price: (pvHi + pvHiPrev) / 2, time: candles[i].time });
        }
      }
    }

    if (isPivotLow(candles, i, lb)) {
      pvLoPrev = pvLo;
      pvLo     = candles[i].low;

      if (pvLoPrev !== null) {
        const tol = pvLoPrev * tolPct / 100;
        if (Math.abs(pvLo - pvLoPrev) <= tol) {
          levels.push({ type: "EQL", price: (pvLo + pvLoPrev) / 2, time: candles[i].time });
        }
      }
    }
  }

  return levels.slice(-6);
}

// ─── Premium / Discount ───────────────────────────────────────────────────────

function detectPremiumDiscount(
  rangeHigh: number,
  rangeLow:  number,
  price:     number,
): PremiumDiscount {
  const mid   = (rangeHigh + rangeLow) / 2;
  const range = rangeHigh - rangeLow;
  let zone: PremiumDiscount["zone"] = "EQUILIBRIUM";
  if (range > 0) {
    if (price > rangeLow + range * 0.75)  zone = "PREMIUM";
    if (price < rangeLow + range * 0.25)  zone = "DISCOUNT";
  }
  return { zone, mid, rangeHigh, rangeLow };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function detectLuxSMC(candles: Candle[]): LuxSmcResult {
  if (candles.length < 20) {
    return {
      events:          [],
      orderBlocks:     [],
      equalLevels:     [],
      fvgZones:        [],
      premiumDiscount: { zone: "EQUILIBRIUM", mid: 0, rangeHigh: 0, rangeLow: 0 },
    };
  }

  const lb  = 5;                              // struct_lookback (Pine default)
  const atr = calcATR(candles, 14);
  const { parsedHighs, parsedLows } = buildFilteredBars(candles, atr);
  const emas = calcEMA(candles, 200);
  const price = candles[candles.length - 1].close;

  // Structure engine (BoS / MSS)
  const struct = detectSmartFlowStructure(candles, emas, parsedHighs, parsedLows, lb);

  // FVG zones
  const fvgZones = detectFVG(candles);

  // EQH/EQL (percentage tolerance)
  const equalLevels = detectEqualLevels(candles, lb, 0.05);

  // Mark mitigated order blocks
  const activeOBs = struct.orderBlocks
    .map(ob => ({ ...ob, broken: ob.type === "BULLISH" ? price < ob.bottom : price > ob.top }))
    .filter(ob => !ob.broken)
    .slice(-6);

  // ── Build event list ───────────────────────────────────────────────────────
  const events: LuxEvent[] = [...struct.events.slice(-4)];

  for (const fvg of fvgZones.slice(-2)) {
    events.push({
      type:   fvg.type === "BULLISH" ? "FVG_BULLISH" : "FVG_BEARISH",
      top:    fvg.top,
      bottom: fvg.bottom,
      time:   fvg.time,
      label:  fvg.type === "BULLISH" ? "🟢 Bullish FVG" : "🔴 Bearish FVG",
    });
  }

  for (const eq of equalLevels.slice(-2)) {
    events.push({
      type:  eq.type,
      price: eq.price,
      time:  eq.time,
      label: eq.type === "EQH"
        ? "🎯 Equal Highs (BSL above)"
        : "🎯 Equal Lows (SSL below)",
    });
  }

  for (const ob of activeOBs.slice(-2)) {
    events.push({
      type:   ob.type === "BULLISH" ? "OB_BULLISH" : "OB_BEARISH",
      top:    ob.top,
      bottom: ob.bottom,
      time:   ob.time,
      label:  ob.type === "BULLISH" ? "🟦 Bullish Order Block" : "🟥 Bearish Order Block",
    });
  }

  // Premium / Discount using trailing swing range
  const trailingHigh = isFinite(struct.trailingHigh) ? struct.trailingHigh : Math.max(...candles.map(c => c.high));
  const trailingLow  = isFinite(struct.trailingLow)  ? struct.trailingLow  : Math.min(...candles.map(c => c.low));
  const pd           = detectPremiumDiscount(trailingHigh, trailingLow, price);

  return {
    events,
    orderBlocks:     activeOBs,
    equalLevels,
    fvgZones,
    premiumDiscount: pd,
    bslLevel:        struct.bslLevel ?? undefined,
    sslLevel:        struct.sslLevel ?? undefined,
    trend:           struct.trend,
    ema200:          emas[emas.length - 1],
  };
}

// ─── Telegram Message Builder ─────────────────────────────────────────────────

export function buildMarketIntelligenceMessage(
  symbol: string,
  price:  number,
  result: LuxSmcResult,
): string {
  const { events, premiumDiscount, bslLevel, sslLevel, trend, ema200 } = result;
  if (!events.length) return "";

  const pd     = premiumDiscount;
  const pdLine =
    pd.zone === "PREMIUM"
      ? "📍 Price in PREMIUM zone (potential sell area)"
      : pd.zone === "DISCOUNT"
      ? "📍 Price in DISCOUNT zone (potential buy area)"
      : "📍 Price at EQUILIBRIUM (mid-range)";

  const trendLine = trend === 1
    ? "📊 Bias: BULLISH ▲"
    : trend === -1
    ? "📊 Bias: BEARISH ▼"
    : "";

  const emaLine = ema200
    ? `〽️ EMA200: $${ema200.toFixed(price < 10 ? 4 : price < 1000 ? 2 : 1)}  ` +
      (price > ema200 ? "price above" : "price below")
    : "";

  const liqLines: string[] = [];
  if (bslLevel) liqLines.push(`🔴 BSL: $${bslLevel.toFixed(price < 10 ? 4 : 2)}`);
  if (sslLevel) liqLines.push(`🟢 SSL: $${sslLevel.toFixed(price < 10 ? 4 : 2)}`);

  const lines = [
    ...events.map(e => e.label),
    "",
    pdLine,
    ...(trendLine ? [trendLine] : []),
    ...(emaLine   ? [emaLine]   : []),
    ...liqLines,
  ].filter(Boolean);

  return (
    `📊 <b>${symbol}</b>  $${price.toFixed(price < 10 ? 4 : price < 1000 ? 2 : 1)}\n\n` +
    lines.join("\n")
  );
}
