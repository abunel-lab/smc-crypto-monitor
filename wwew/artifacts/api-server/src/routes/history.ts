import { Router, type IRouter } from "express";
import { dbGetRecentSignals, dbGetRecentTrades } from "../lib/db";

const router: IRouter = Router();

router.get("/signals", async (_req, res) => {
  const signals = await dbGetRecentSignals(100);
  res.json(signals);
});

router.get("/trades/history", async (_req, res) => {
  const trades = await dbGetRecentTrades(50);
  res.json(trades);
});

export default router;
