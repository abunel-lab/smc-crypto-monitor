import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getMonitorStatus } from "../lib/cryptoMonitor";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ─── /api/test — quick system self-check ──────────────────────────────────────
// Mirrors the simple one-file app's /test route.
// Returns SYSTEM OK if the monitor has data, or WARMING UP if it's still loading.

router.get("/test", (_req, res) => {
  try {
    const status = getMonitorStatus();
    const symbolsWithData = status.symbols.filter(
      (sym) => status.symbolStatus[sym]?.priceOkx > 0,
    );

    if (symbolsWithData.length === 0) {
      return res.json({
        status: "WARMING UP ⏳",
        message: "Monitor is running but hasn't completed a full cycle yet. Try again in ~30s.",
      });
    }

    const summary: Record<string, object> = {};
    for (const sym of symbolsWithData) {
      const s = status.symbolStatus[sym];
      summary[sym] = {
        price:      s.priceOkx,
        signal:     s.signal,
        bias:       s.bias,
        confidence: s.confidence,
        hasFVG:     s.hasFVG,
        fvgZones:   s.fvgZones.length,
        entrySignal: s.entrySignal ?? "WAIT",
        sl:         s.sl,
        tp:         s.tp,
      };
    }

    res.json({
      status: "SYSTEM OK ✅",
      symbols: symbolsWithData,
      data: summary,
      performance: status.performance,
    });
  } catch (err) {
    res.status(500).json({ status: "ERROR ❌", error: String(err) });
  }
});

export default router;
