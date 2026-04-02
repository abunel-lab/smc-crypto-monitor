import { db } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";
import {
  tradesTable,
  signalsTable,
  equitySnapshotsTable,
} from "@workspace/db/schema";

// ─── Trades ──────────────────────────────────────────────────────────────────

export async function dbSaveTrade(trade: {
  id: string;
  symbol: string;
  direction: string;
  entry: number;
  sl: number;
  tp: number;
  status: string;
  openedAt: number;
  closedAt?: number;
  pnlPct?: number;
}): Promise<void> {
  try {
    await db
      .insert(tradesTable)
      .values({
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entry: trade.entry,
        sl: trade.sl,
        tp: trade.tp,
        status: trade.status,
        openedAt: new Date(trade.openedAt),
        closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
        pnlPct: trade.pnlPct ?? null,
      })
      .onConflictDoUpdate({
        target: tradesTable.id,
        set: {
          status: trade.status,
          closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
          pnlPct: trade.pnlPct ?? null,
        },
      });
  } catch (err) {
    logger.warn({ err, tradeId: trade.id }, "Failed to persist trade to DB");
  }
}

export async function dbLoadOpenTrades(): Promise<
  Array<{
    id: string;
    symbol: string;
    direction: "BUY" | "SELL";
    entry: number;
    sl: number;
    tp: number;
    status: "OPEN";
    openedAt: number;
  }>
> {
  try {
    const rows = await db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.status, "OPEN"));
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction as "BUY" | "SELL",
      entry: r.entry,
      sl: r.sl,
      tp: r.tp,
      status: "OPEN" as const,
      openedAt: r.openedAt.getTime(),
    }));
  } catch (err) {
    logger.warn({ err }, "Failed to load open trades from DB");
    return [];
  }
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export async function dbSaveSignal(signal: {
  symbol: string;
  direction: string;
  confidence: string;
  flow: string;
  bias: string;
  bos: string | null;
  choch: string | null;
  liquidity: string | null;
  hasFvg: boolean;
  fvgTouch: string | null;
  tf4h: string;
  tf1h: string;
  tf15m: string;
  tf5m: string;
  priceAtSignal: number;
}): Promise<void> {
  try {
    await db.insert(signalsTable).values({
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      flow: signal.flow,
      bias: signal.bias,
      bos: signal.bos,
      choch: signal.choch,
      liquidity: signal.liquidity,
      hasFvg: signal.hasFvg,
      fvgTouch: signal.fvgTouch,
      tf4h: signal.tf4h,
      tf1h: signal.tf1h,
      tf15m: signal.tf15m,
      tf5m: signal.tf5m,
      priceAtSignal: signal.priceAtSignal,
    });
  } catch (err) {
    logger.warn(
      { err, symbol: signal.symbol },
      "Failed to persist signal to DB",
    );
  }
}

// ─── Equity Snapshots ─────────────────────────────────────────────────────────

export async function dbSaveEquitySnapshot(snapshot: {
  balance: number;
  wins: number;
  losses: number;
}): Promise<void> {
  try {
    await db.insert(equitySnapshotsTable).values({
      balance: snapshot.balance,
      wins: snapshot.wins,
      losses: snapshot.losses,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to persist equity snapshot to DB");
  }
}

export async function dbLoadLatestEquity(): Promise<{
  balance: number;
  wins: number;
  losses: number;
} | null> {
  try {
    const rows = await db
      .select()
      .from(equitySnapshotsTable)
      .orderBy(desc(equitySnapshotsTable.id))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      balance: rows[0].balance,
      wins: rows[0].wins,
      losses: rows[0].losses,
    };
  } catch (err) {
    logger.warn({ err }, "Failed to load equity from DB");
    return null;
  }
}

// ─── Recent Signals (for API) ─────────────────────────────────────────────────

export async function dbGetRecentSignals(
  limit = 50,
): Promise<(typeof signalsTable.$inferSelect)[]> {
  try {
    return await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.id))
      .limit(limit);
  } catch (err) {
    logger.warn({ err }, "Failed to load recent signals from DB");
    return [];
  }
}

export async function dbGetRecentTrades(
  limit = 20,
): Promise<(typeof tradesTable.$inferSelect)[]> {
  try {
    return await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.openedAt))
      .limit(limit);
  } catch (err) {
    logger.warn({ err }, "Failed to load recent trades from DB");
    return [];
  }
}
