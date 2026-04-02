import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SwingPoint {
  index: number;
  price: number;
  time: number;
}

interface FVG {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  time: number;
}

async function getCandles(symbol: string, interval = "1m", limit = 200): Promise<Candle[]> {
  // Try Binance US first, fall back to Binance global
  const urls = [
    `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (!Array.isArray(data)) continue;
      return (data as Array<[number, string, string, string, string, ...unknown[]]>).map((c) => ({
        time: c[0] / 1000,
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
      }));
    } catch {
      continue;
    }
  }

  throw new Error("All Binance endpoints failed or geo-blocked");
}

function getSwings(candles: Candle[]): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high > candles[i + 1].high &&
      c.high > candles[i + 2].high
    ) {
      highs.push({ index: i, price: c.high, time: c.time });
    }
    if (
      c.low < candles[i - 1].low &&
      c.low < candles[i - 2].low &&
      c.low < candles[i + 1].low &&
      c.low < candles[i + 2].low
    ) {
      lows.push({ index: i, price: c.low, time: c.time });
    }
  }

  return { highs, lows };
}

function detectStructure(candles: Candle[]): { bos: SwingPoint[]; choch: SwingPoint[] } {
  const { highs, lows } = getSwings(candles);
  const bos: SwingPoint[] = [];
  const choch: SwingPoint[] = [];

  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) bos.push(highs[i]);
  }
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price < lows[i - 1].price) bos.push(lows[i]);
  }

  if (highs.length > 1 && lows.length > 1) {
    if (highs[highs.length - 1].price < highs[highs.length - 2].price)
      choch.push(highs[highs.length - 1]);
    if (lows[lows.length - 1].price > lows[lows.length - 2].price)
      choch.push(lows[lows.length - 1]);
  }

  return { bos, choch };
}

function detectFVG(candles: Candle[]): FVG[] {
  const gaps: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c1.high < c3.low) {
      gaps.push({ type: "bullish", top: c3.low, bottom: c1.high, time: c3.time });
    }
    if (c1.low > c3.high) {
      gaps.push({ type: "bearish", top: c1.low, bottom: c3.high, time: c3.time });
    }
  }
  return gaps.slice(-30);
}

router.get("/candles", async (req, res) => {
  const symbol = (req.query.symbol as string) || "BTCUSDT";
  const interval = (req.query.interval as string) || "1m";
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  try {
    const candles = await getCandles(symbol, interval, limit);
    const structure = detectStructure(candles);
    const fvg = detectFVG(candles);
    res.json({ candles, bos: structure.bos, choch: structure.choch, fvg });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch candles");
    res.status(502).json({ error: "Failed to fetch candle data" });
  }
});

export default router;
