import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Trades ──────────────────────────────────────────────────────────────────

export const tradesTable = pgTable("trades", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "BUY" | "SELL"
  entry: real("entry").notNull(),
  sl: real("sl").notNull(),
  tp: real("tp").notNull(),
  status: text("status").notNull(), // "OPEN" | "WIN" | "LOSS"
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
  pnlPct: real("pnl_pct"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;

// ─── Signals ─────────────────────────────────────────────────────────────────

export const signalsTable = pgTable("signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "BUY" | "SELL" | "SELL_WAIT" | "WAIT"
  confidence: text("confidence").notNull(), // "LOW" | "MEDIUM" | "HIGH"
  flow: text("flow").notNull(),
  bias: text("bias").notNull(),
  bos: text("bos"),
  choch: text("choch"),
  liquidity: text("liquidity"),
  hasFvg: boolean("has_fvg").notNull().default(false),
  fvgTouch: text("fvg_touch"),
  tf4h: text("tf_4h").notNull(),
  tf1h: text("tf_1h").notNull(),
  tf15m: text("tf_15m").notNull(),
  tf5m: text("tf_5m").notNull(),
  priceAtSignal: real("price_at_signal").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({
  createdAt: true,
});
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;

// ─── Equity Snapshots ─────────────────────────────────────────────────────────

export const equitySnapshotsTable = pgTable("equity_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  balance: real("balance").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEquitySnapshotSchema = createInsertSchema(
  equitySnapshotsTable,
).omit({ createdAt: true });
export type InsertEquitySnapshot = z.infer<typeof insertEquitySnapshotSchema>;
export type EquitySnapshot = typeof equitySnapshotsTable.$inferSelect;

// ─── Symbol Status Snapshots ──────────────────────────────────────────────────

export const symbolStatusTable = pgTable("symbol_status", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: text("symbol").notNull(),
  priceOkx: real("price_okx").notNull(),
  priceCg: real("price_cg").notNull(),
  oi: real("oi").notNull(),
  volume: real("volume").notNull(),
  funding: real("funding").notNull(),
  bias: text("bias").notNull(),
  signal: text("signal").notNull(),
  confidence: text("confidence").notNull(),
  fvgZones: jsonb("fvg_zones").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSymbolStatusSchema = createInsertSchema(
  symbolStatusTable,
).omit({ createdAt: true });
export type InsertSymbolStatus = z.infer<typeof insertSymbolStatusSchema>;
export type SymbolStatus = typeof symbolStatusTable.$inferSelect;
