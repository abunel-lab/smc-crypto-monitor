import { Router, type IRouter } from "express";
import {
  getMonitorStatus,
  getCandlesWithTime,
  detectFVGWithTime,
  findSwings,
  detectStructure,
  SYMBOL_TO_INSTID,
} from "../lib/cryptoMonitor";
import { detectLuxSMC } from "../engine/luxSmc";

const router: IRouter = Router();

// ─── Monitor Status ───────────────────────────────────────────────────────────

router.get("/monitor/status", (_req, res) => {
  res.json(getMonitorStatus());
});

// ─── Candles + Full SMC Overlay ───────────────────────────────────────────────
// GET /api/candles?symbol=BTCUSDT&interval=5m
// Returns candles + BOS + CHOCH + FVG + Order Blocks + Equal Levels

const INTERVAL_MAP: Record<string, string> = {
  "1m":  "1m",
  "5m":  "5m",
  "15m": "15m",
  "1h":  "1H",
  "4h":  "4H",
};

router.get("/candles", async (req, res) => {
  const symbol   = (req.query.symbol   as string | undefined) ?? "BTCUSDT";
  const interval = (req.query.interval as string | undefined) ?? "5m";

  const instId = SYMBOL_TO_INSTID[symbol];
  if (!instId) {
    res.status(400).json({ error: `Unknown symbol: ${symbol}` });
    return;
  }

  const bar = INTERVAL_MAP[interval] ?? "5m";

  try {
    const candles = await getCandlesWithTime(instId, bar, 150);
    if (!candles.length) {
      res.status(502).json({ error: "No candle data returned from OKX" });
      return;
    }

    // Classic SMC overlays
    const swings    = findSwings(candles);
    const structure = detectStructure(swings);
    const fvgZones  = detectFVGWithTime(candles);

    // LuxSMC overlays (Order Blocks + Equal Levels)
    const lux = detectLuxSMC(candles);

    // BOS levels — last 4 swings only
    const bosPoints = swings
      .filter((_, idx) => idx >= swings.length - 4)
      .map((s) => ({
        index: s.index,
        price: s.price,
        time:  candles[s.index]?.time ?? candles[candles.length - 1].time,
      }));

    // CHOCH levels
    const chochPoints =
      structure.choch
        ? [swings[swings.length - 1]].filter(Boolean).map((s) => ({
            index: s.index,
            price: s.price,
            time:  candles[s.index]?.time ?? candles[candles.length - 1].time,
          }))
        : [];

    res.json({
      candles: candles.map(({ time, open, high, low, close }) => ({
        time, open, high, low, close,
      })),
      bos:   bosPoints,
      choch: chochPoints,
      fvg:   fvgZones.map(({ type, top, bottom, time }) => ({
        type: type.toLowerCase() as "bullish" | "bearish",
        top, bottom, time,
      })),
      orderBlocks:  lux.orderBlocks,
      equalLevels:  lux.equalLevels,
      premiumDiscount: lux.premiumDiscount,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch candle data" });
  }
});

export default router;
