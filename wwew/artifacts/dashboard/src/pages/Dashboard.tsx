import React, { useState, Component, type ReactNode } from "react";
import { useMonitor } from "@/hooks/use-monitor";
import { useQuery } from "@tanstack/react-query";
import { TerminalCard, Badge, LiveValue, UtcClock } from "@/components/TerminalUI";
import { CandleChart } from "@/components/CandleChart";
import { formatCurrency, formatLargeNumber, formatPercentage, cn } from "@/lib/utils";
import { Activity, ArrowUpRight, ArrowDownRight, Crosshair, AlertTriangle, CheckCircle2, XCircle, History, Filter } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, LineChart, Line } from "recharts";
import { motion, AnimatePresence } from "framer-motion";

// ─── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-destructive font-mono flex-col gap-4">
          <AlertTriangle className="w-16 h-16" />
          <h2 className="text-xl">DASHBOARD ERROR</h2>
          <p className="text-sm opacity-70">An unexpected error occurred.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 px-4 py-2 border border-destructive rounded text-xs hover:bg-destructive/10"
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
interface LuxEvent {
  type: string;
  price?: number;
  top?: number;
  bottom?: number;
  time: number;
  label: string;
}

interface OrderBlock {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  time: number;
  broken: boolean;
}

interface EqualLevel {
  type: "EQH" | "EQL";
  price: number;
  time: number;
}

interface PremiumDiscount {
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  mid: number;
  rangeHigh: number;
  rangeLow: number;
}

interface NormalizedSymbol {
  priceOkx: number;
  priceCg: number;
  oi: number;
  volume: number;
  funding: number;
  bias: string;
  tf4h: string;
  tf1h: string;
  tf15m: string;
  tf5m: string;
  signal: string;
  confidence: string;
  entrySignal: string | null;
  entryPrice: number | null;
  sl: number | null;
  tp: number | null;
  luxEvents: LuxEvent[];
  orderBlocks: OrderBlock[];
  equalLevels: EqualLevel[];
  premiumDiscount: PremiumDiscount | null;
}

function normalizeSymbol(raw?: Partial<NormalizedSymbol> | null): NormalizedSymbol {
  return {
    priceOkx:        raw?.priceOkx        ?? 0,
    priceCg:         raw?.priceCg         ?? 0,
    oi:              raw?.oi              ?? 0,
    volume:          raw?.volume          ?? 0,
    funding:         raw?.funding         ?? 0,
    bias:            raw?.bias            ?? "⚖️ NEUTRAL",
    tf4h:            raw?.tf4h            ?? "-",
    tf1h:            raw?.tf1h            ?? "-",
    tf15m:           raw?.tf15m           ?? "-",
    tf5m:            raw?.tf5m            ?? "-",
    signal:          raw?.signal          ?? "WAITING...",
    confidence:      raw?.confidence      ?? "LOW",
    entrySignal:     raw?.entrySignal     ?? null,
    entryPrice:      raw?.entryPrice      ?? null,
    sl:              raw?.sl              ?? null,
    tp:              raw?.tp              ?? null,
    luxEvents:       raw?.luxEvents       ?? [],
    orderBlocks:     raw?.orderBlocks     ?? [],
    equalLevels:     raw?.equalLevels     ?? [],
    premiumDiscount: raw?.premiumDiscount ?? null,
  };
}

function getLuxEventVariant(type: string) {
  if (type.includes("BULLISH") || type === "EQL") return "text-primary bg-primary/5 border-primary/20";
  if (type.includes("BEARISH") || type === "EQH") return "text-destructive bg-destructive/5 border-destructive/20";
  if (type.includes("CHOCH")) return "text-yellow-400 bg-yellow-400/5 border-yellow-400/20";
  if (type.includes("OB_BULLISH")) return "text-blue-400 bg-blue-400/5 border-blue-400/20";
  if (type.includes("OB_BEARISH")) return "text-purple-400 bg-purple-400/5 border-purple-400/20";
  return "text-muted-foreground bg-muted/20 border-border";
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toUTCString().slice(17, 22) + " UTC";
}

function formatPrice(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== "number" || isNaN(value)) return "-";
  return value.toFixed(decimals);
}

function safeFormatCurrency(value: number | null | undefined, decimals?: number): string {
  if (typeof value !== "number" || isNaN(value)) return "-";
  return formatCurrency(value, decimals);
}

// ─── Signals History View ──────────────────────────────────────────────────────
interface Signal {
  id: number;
  symbol: string;
  direction: string;
  confidence: string;
  flow: string;
  bias: string;
  bos: string | null;
  choch: string | null;
  hasFvg: boolean;
  fvgTouch: string | null;
  tf4h: string;
  tf1h: string;
  tf15m: string;
  tf5m: string;
  priceAtSignal: number;
  createdAt: string;
}

function SignalsHistoryView() {
  const [filterSym, setFilterSym] = useState<string>("ALL");
  const [filterConf, setFilterConf] = useState<string>("ALL");

  const { data: signals = [], isLoading, isError, refetch } = useQuery<Signal[]>({
    queryKey: ["signals-history"],
    queryFn: async () => {
      const res = await fetch("/api/signals");
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const symbols = ["ALL", "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
  const confidences = ["ALL", "HIGH", "MEDIUM", "LOW"];

  const filtered = signals.filter(s => {
    const symOk = filterSym === "ALL" || s.symbol === filterSym;
    const confOk = filterConf === "ALL" || s.confidence === filterConf;
    return symOk && confOk;
  });

  const stats = {
    total: signals.length,
    high: signals.filter(s => s.confidence === "HIGH").length,
    medium: signals.filter(s => s.confidence === "MEDIUM").length,
    low: signals.filter(s => s.confidence === "LOW").length,
    btc: signals.filter(s => s.symbol === "BTCUSDT").length,
    eth: signals.filter(s => s.symbol === "ETHUSDT").length,
    sol: signals.filter(s => s.symbol === "SOLUSDT").length,
    bnb: signals.filter(s => s.symbol === "BNBUSDT").length,
    xrp: signals.filter(s => s.symbol === "XRPUSDT").length,
  };

  const getDirectionStyle = (dir: string) => {
    if (dir === "BUY") return "bg-primary/20 text-primary";
    if (dir === "SELL") return "bg-destructive/20 text-destructive";
    return "bg-muted/30 text-muted-foreground";
  };

  const getConfStyle = (conf: string) => {
    if (conf === "HIGH") return "text-primary bg-primary/5 border-primary/30";
    if (conf === "MEDIUM") return "text-yellow-400 bg-yellow-400/5 border-yellow-400/30";
    return "text-muted-foreground bg-muted/20 border-border";
  };

  const getTfDot = (tf: string) => {
    if (tf === "bullish") return "bg-primary";
    if (tf === "bearish") return "bg-destructive";
    return "bg-muted-foreground/40";
  };

  return (
    <div className="flex flex-col gap-6">
      {/* STATS STRIP */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
        {[
          { label: "TOTAL",  value: stats.total,  color: "text-foreground" },
          { label: "HIGH",   value: stats.high,   color: "text-primary" },
          { label: "MEDIUM", value: stats.medium, color: "text-yellow-400" },
          { label: "LOW",    value: stats.low,    color: "text-muted-foreground" },
          { label: "BTC",    value: stats.btc,    color: "text-orange-400" },
          { label: "ETH",    value: stats.eth,    color: "text-blue-400" },
          { label: "SOL",    value: stats.sol,    color: "text-purple-400" },
          { label: "BNB",    value: stats.bnb,    color: "text-yellow-500" },
          { label: "XRP",    value: stats.xrp,    color: "text-cyan-400" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-3 font-mono text-center">
            <p className="text-[10px] text-muted-foreground mb-1">{s.label}</p>
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">SYMBOL:</span>
          <div className="flex gap-1">
            {symbols.map(sym => (
              <button
                key={sym}
                onClick={() => setFilterSym(sym)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-mono border transition-colors",
                  filterSym === sym
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-card border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {sym === "ALL" ? "ALL" : sym.replace("USDT", "")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">CONF:</span>
          <div className="flex gap-1">
            {confidences.map(c => (
              <button
                key={c}
                onClick={() => setFilterConf(c)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-mono border transition-colors",
                  filterConf === c
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-card border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="ml-auto px-3 py-1 rounded text-xs font-mono border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          REFRESH
        </button>
      </div>

      {/* TABLE */}
      <TerminalCard title={`SIGNAL HISTORY — ${filtered.length} RECORD${filtered.length !== 1 ? "S" : ""}`}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground font-mono text-sm">
            <Activity className="w-4 h-4 animate-pulse" />
            LOADING SIGNALS...
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 gap-3 text-destructive font-mono text-sm">
            <AlertTriangle className="w-4 h-4" />
            FAILED TO LOAD SIGNALS
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground font-mono text-sm">
            <History className="w-4 h-4" />
            NO SIGNALS MATCH FILTERS
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono text-left">
              <thead className="text-[10px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="pb-3 font-normal pr-4">TIME (UTC)</th>
                  <th className="pb-3 font-normal pr-4">SYMBOL</th>
                  <th className="pb-3 font-normal pr-4">FLOW</th>
                  <th className="pb-3 font-normal pr-4">DIR</th>
                  <th className="pb-3 font-normal pr-4">CONF</th>
                  <th className="pb-3 font-normal pr-4">BOS</th>
                  <th className="pb-3 font-normal pr-4">CHoCH</th>
                  <th className="pb-3 font-normal pr-4">FVG</th>
                  <th className="pb-3 font-normal pr-4">TF</th>
                  <th className="pb-3 font-normal text-right">PRICE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map(sig => (
                  <motion.tr
                    key={sig.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-muted/20 transition-colors group"
                  >
                    <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                      {new Date(sig.createdAt).toUTCString().slice(5, 22)}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">
                      {sig.symbol.replace("USDT", "")}
                    </td>
                    <td className="py-2.5 pr-4 max-w-[160px]">
                      <span className="text-[10px] opacity-80 leading-tight">{sig.flow}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", getDirectionStyle(sig.direction))}>
                        {sig.direction}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={cn("px-1.5 py-0.5 rounded border text-[10px]", getConfStyle(sig.confidence))}>
                        {sig.confidence}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      {sig.bos ? (
                        <span className={sig.bos === "BULLISH" ? "text-primary" : "text-destructive"}>
                          {sig.bos.slice(0, 4)}
                        </span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {sig.choch ? (
                        <span className="text-yellow-400">{sig.choch.slice(0, 4)}</span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {sig.hasFvg ? (
                        <span className={sig.fvgTouch === "bullish" ? "text-primary" : sig.fvgTouch === "bearish" ? "text-destructive" : "text-yellow-400"}>
                          {sig.fvgTouch ? sig.fvgTouch.toUpperCase().slice(0, 4) : "YES"}
                        </span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex gap-0.5 items-center">
                        {[sig.tf4h, sig.tf1h, sig.tf15m, sig.tf5m].map((tf, i) => (
                          <div key={i} className={cn("w-2 h-2 rounded-full", getTfDot(tf))} title={["4H","1H","15M","5M"][i] + ": " + tf} />
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 text-right text-foreground/80">
                      ${sig.priceAtSignal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TerminalCard>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
function DashboardInner() {
  const { data, priceHistory, isLoading, isError } = useMonitor();
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTCUSDT");
  const [view, setView] = useState<"overview" | "chart" | "signals">("overview");

  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background flex-col gap-6">
        <Activity className="w-12 h-12 text-primary animate-pulse" />
        <p className="text-muted-foreground font-mono animate-pulse">CONNECTING TO DATAFEED...</p>
      </div>
    );
  }

  const symbols: string[] = Array.isArray(data?.symbols) ? data.symbols : [];

  if (isError || !data || symbols.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-destructive font-mono">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-16 h-16" />
          <h2 className="text-xl">SIGNAL LOST</h2>
          <p className="text-sm opacity-70">Unable to reach API endpoint.</p>
        </div>
      </div>
    );
  }

  const activeSymbol = symbols.includes(selectedSymbol) ? selectedSymbol : symbols[0];
  const symbolData = normalizeSymbol(data.symbolStatus?.[activeSymbol]);
  const activeHistory = priceHistory[activeSymbol] || [];

  const performance = data.performance ?? { wins: 0, losses: 0, winRate: 0, balance: 1000, initialBalance: 1000, equityHistory: [] };
  const openTrades = Array.isArray(data.openTrades) ? data.openTrades : [];
  const recentTrades = Array.isArray(data.recentTrades) ? data.recentTrades : [];

  const getSignalVariant = (text: string) => {
    if (!text) return "neutral";
    if (text.includes("BULLISH") || text.includes("ACCUMULATION") || text.includes("LONG SQUEEZE") || text.includes("BUY")) return "success";
    if (text.includes("BEARISH") || text.includes("DISTRIBUTION") || text.includes("SHORT SQUEEZE") || text.includes("SELL")) return "danger";
    if (text.includes("TRAP") || text.includes("RISK")) return "warning";
    return "neutral";
  };

  const getTimeframeVariant = (trend: string) => {
    if (trend === "bullish") return "success";
    if (trend === "bearish") return "danger";
    return "neutral";
  };

  const pnl = performance.balance - performance.initialBalance;

  return (
    <div className="min-h-screen max-w-[1800px] mx-auto p-4 md:p-6 flex flex-col gap-6 font-sans">

      {/* HEADER */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-border gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Crosshair className="w-6 h-6 text-primary" />
            SMC TERMINAL <span className="text-xs text-muted-foreground font-mono font-normal ml-2 border border-border px-2 py-1 rounded">v2.4.0</span>
          </h1>
        </div>

        <div className="flex bg-card border border-border rounded-lg overflow-hidden font-mono text-sm">
          <button
            onClick={() => setView("overview")}
            className={cn(
              "px-4 py-2 transition-colors",
              view === "overview" ? "bg-primary/20 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted"
            )}
          >
            OVERVIEW
          </button>
          <button
            onClick={() => setView("chart")}
            className={cn(
              "px-4 py-2 transition-colors",
              view === "chart" ? "bg-primary/20 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted"
            )}
          >
            CHART
          </button>
          <button
            onClick={() => setView("signals")}
            className={cn(
              "px-4 py-2 transition-colors",
              view === "signals" ? "bg-primary/20 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted"
            )}
          >
            SIGNALS
          </button>
        </div>

        <UtcClock />
      </header>

      {/* SYMBOL TABS */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {symbols.map(sym => (
          <button
            key={sym}
            onClick={() => setSelectedSymbol(sym)}
            className={cn(
              "px-6 py-3 rounded-lg font-mono text-sm font-semibold transition-all duration-200 border whitespace-nowrap",
              activeSymbol === sym
                ? "bg-primary/10 border-primary text-primary shadow-[0_0_15px_rgba(0,255,163,0.15)]"
                : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {sym.replace("USDT", "")}
          </button>
        ))}
      </div>

      {view === "signals" ? (
        <SignalsHistoryView />
      ) : view === "chart" ? (
        <div className="w-full flex-1 mt-4">
          <CandleChart symbol={activeSymbol} />
        </div>
      ) : (
        <>
          {/* ── 5-Coin Mini Grid ─────────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-2">
            {symbols.map((sym) => {
              const sd = normalizeSymbol(data.symbolStatus?.[sym]);
              const label = sym.replace("USDT", "");
              const price = sd.priceOkx;
              const priceStr = price < 10 ? price.toFixed(4) : price < 1000 ? price.toFixed(2) : price.toFixed(1);
              const isBull = sd.bias?.includes("BULL");
              const isBear = sd.bias?.includes("BEAR");
              const isActive = sym === activeSymbol;
              return (
                <button
                  key={sym}
                  onClick={() => { setSelectedSymbol(sym); setView("overview"); }}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-2 text-left font-mono transition-all",
                    isActive ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/40",
                    isBull ? "border-l-2 border-l-primary" : isBear ? "border-l-2 border-l-destructive" : ""
                  )}
                >
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                  <span className="text-sm font-bold leading-tight truncate">${priceStr}</span>
                  <span className={cn(
                    "text-[9px] font-bold truncate",
                    isBull ? "text-primary" : isBear ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {isBull ? "▲ BULL" : isBear ? "▼ BEAR" : "— NEUT"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* LEFT COLUMN */}
            <div className="lg:col-span-4 flex flex-col gap-6">

              <TerminalCard glow={symbolData.confidence === "HIGH"}>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-muted-foreground font-mono text-sm mb-1">OKX PERP</p>
                    <div className="text-5xl font-mono font-bold tracking-tighter">
                      <LiveValue value={symbolData.priceOkx} format={(v) => formatCurrency(v, v < 1000 ? 3 : 1)} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground font-mono text-sm mb-1">COINGECKO REF</p>
                    <p className="text-lg font-mono text-foreground/80">
                      {safeFormatCurrency(symbolData.priceCg, symbolData.priceCg < 1000 ? 3 : 1)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                    <p className="text-xs text-muted-foreground font-mono mb-2">SIGNAL</p>
                    <Badge variant={getSignalVariant(symbolData.signal)} className="w-full text-center py-1.5 text-[10px] sm:text-xs">
                      {symbolData.signal}
                    </Badge>
                  </div>
                  <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                    <p className="text-xs text-muted-foreground font-mono mb-2">CONFIDENCE</p>
                    <Badge variant={
                      symbolData.confidence === "HIGH" ? "success" :
                      symbolData.confidence === "MEDIUM" ? "warning" : "neutral"
                    } className="w-full text-center py-1.5">
                      {symbolData.confidence}
                    </Badge>
                  </div>
                </div>

                <div className="bg-background rounded-lg border border-border p-4 mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs text-muted-foreground font-mono">BIAS</span>
                    <span className={cn("text-sm font-bold font-mono",
                      symbolData.bias?.includes("BULL") ? "text-primary" :
                      symbolData.bias?.includes("BEAR") ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {symbolData.bias}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: "4H",  val: symbolData.tf4h },
                      { label: "1H",  val: symbolData.tf1h },
                      { label: "15M", val: symbolData.tf15m },
                      { label: "5M",  val: symbolData.tf5m },
                    ].map(tf => (
                      <div key={tf.label} className={cn(
                        "flex flex-col items-center justify-center p-2 rounded border font-mono text-xs gap-1",
                        tf.val === "bullish" ? "bg-primary/5 border-primary/20 text-primary" :
                        tf.val === "bearish" ? "bg-destructive/5 border-destructive/20 text-destructive" :
                        "bg-muted/50 border-border text-muted-foreground"
                      )}>
                        <span className="opacity-70">{tf.label}</span>
                        <span className="font-bold text-[10px] uppercase">{(tf.val ?? "-").substring(0, 4)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border font-mono">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">FUNDING</p>
                    <p className={cn("text-sm", symbolData.funding > 0 ? "text-destructive" : "text-primary")}>
                      {formatPercentage(symbolData.funding)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">OI</p>
                    <p className="text-sm text-foreground/80">{formatLargeNumber(symbolData.oi)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">VOLUME</p>
                    <p className="text-sm text-foreground/80">{formatLargeNumber(symbolData.volume)}</p>
                  </div>
                </div>
              </TerminalCard>

              {/* ACTIVE TRADE SETUP */}
              <AnimatePresence>
                {symbolData.entrySignal && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      "p-[2px] rounded-xl relative overflow-hidden",
                      symbolData.entrySignal === "BUY" ? "bg-gradient-to-br from-primary to-primary/20" : "bg-gradient-to-br from-destructive to-destructive/20"
                    )}
                  >
                    <div className="absolute inset-0 bg-black/40 animate-pulse-fast" />
                    <div className="relative bg-card rounded-[10px] p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className={cn(
                          "p-2 rounded-full",
                          symbolData.entrySignal === "BUY" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
                        )}>
                          {symbolData.entrySignal === "BUY" ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg tracking-tight">ACTIVE SETUP</h3>
                          <p className="text-xs font-mono text-muted-foreground">ALGO EXECUTION IN PROGRESS</p>
                        </div>
                      </div>

                      <div className="space-y-3 font-mono">
                        <div className="flex justify-between items-center bg-background/50 p-2 rounded">
                          <span className="text-xs text-muted-foreground">ENTRY</span>
                          <span className="font-bold">{safeFormatCurrency(symbolData.entryPrice, 2)}</span>
                        </div>
                        <div className="flex justify-between items-center bg-background/50 p-2 rounded">
                          <span className="text-xs text-destructive">STOP LOSS</span>
                          <span className="font-bold text-destructive">{safeFormatCurrency(symbolData.sl, 2)}</span>
                        </div>
                        <div className="flex justify-between items-center bg-background/50 p-2 rounded">
                          <span className="text-xs text-primary">TAKE PROFIT</span>
                          <span className="font-bold text-primary">{safeFormatCurrency(symbolData.tp, 2)}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              <TerminalCard title={`LIVE PRICE ACTION - ${activeSymbol}`} className="h-[400px]">
                <div className="flex-1 w-full h-full min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activeHistory} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickMargin={10} minTickGap={30} />
                      <YAxis domain={["auto", "auto"]} stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(val) => `$${val}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        itemStyle={{ color: "hsl(var(--foreground))", fontFamily: "monospace" }}
                        labelStyle={{ color: "hsl(var(--muted-foreground))", fontFamily: "monospace", marginBottom: "4px" }}
                      />
                      <Area type="monotone" dataKey="price" stroke="hsl(var(--accent))" strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" isAnimationActive={false} />
                      {symbolData.entrySignal && symbolData.entryPrice != null && (
                        <ReferenceLine
                          y={symbolData.entryPrice}
                          stroke="hsl(var(--primary))"
                          strokeDasharray="3 3"
                          label={{ position: "insideTopLeft", value: "ENTRY", fill: "hsl(var(--primary))", fontSize: 10 }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </TerminalCard>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <TerminalCard title="PERFORMANCE" className="md:col-span-1">
                  <div className="flex flex-col h-full justify-between">
                    <div className="space-y-4 font-mono">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">TOTAL P&L</p>
                        <p className={cn(
                          "text-3xl font-bold tracking-tighter",
                          pnl >= 0 ? "text-primary" : "text-destructive"
                        )}>
                          {safeFormatCurrency(pnl)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                        <div>
                          <p className="text-[10px] text-muted-foreground">WIN RATE</p>
                          <p className="text-lg text-foreground">{formatPrice(performance.winRate, 1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">TRADES</p>
                          <p className="text-lg text-foreground">{(performance.wins ?? 0) + (performance.losses ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">WINS</p>
                          <p className="text-lg text-primary">{performance.wins ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">LOSSES</p>
                          <p className="text-lg text-destructive">{performance.losses ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </TerminalCard>

                <TerminalCard title="EQUITY CURVE" className="md:col-span-2">
                  <div className="flex-1 w-full h-full min-h-[150px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={(performance.equityHistory ?? []).map((val, i) => ({ index: i, balance: val }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <YAxis domain={["dataMin - 100", "auto"]} hide />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                          formatter={(val: number) => [safeFormatCurrency(val), "Balance"]}
                          labelFormatter={() => ""}
                        />
                        <Line type="stepAfter" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </TerminalCard>
              </div>
            </div>
          </div>

          {/* SMC EVENTS + ORDER BLOCKS + PREMIUM/DISCOUNT */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-2">

            {/* LUX EVENTS FEED */}
            <TerminalCard title="SMC EVENTS (LIVE)" className="md:col-span-1">
              <div className="space-y-1.5 overflow-y-auto max-h-48">
                {symbolData.luxEvents.length === 0 ? (
                  <p className="text-xs font-mono text-muted-foreground italic py-4 text-center">No events detected</p>
                ) : (
                  [...symbolData.luxEvents].reverse().map((ev, i) => (
                    <div key={i} className={cn("flex items-start justify-between gap-2 px-2.5 py-1.5 rounded border text-xs font-mono", getLuxEventVariant(ev.type))}>
                      <span className="flex-1 leading-tight">{ev.label}</span>
                      <span className="opacity-50 shrink-0 text-[10px]">{formatTime(ev.time)}</span>
                    </div>
                  ))
                )}
              </div>
            </TerminalCard>

            {/* ORDER BLOCKS */}
            <TerminalCard title="ORDER BLOCKS" className="md:col-span-1">
              <div className="space-y-1.5 overflow-y-auto max-h-48">
                {symbolData.orderBlocks.filter(ob => !ob.broken).length === 0 ? (
                  <p className="text-xs font-mono text-muted-foreground italic py-4 text-center">No active OBs</p>
                ) : (
                  symbolData.orderBlocks.filter(ob => !ob.broken).map((ob, i) => (
                    <div key={i} className={cn(
                      "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs font-mono",
                      ob.type === "BULLISH" ? "text-blue-400 bg-blue-400/5 border-blue-400/20" : "text-purple-400 bg-purple-400/5 border-purple-400/20"
                    )}>
                      <span>{ob.type === "BULLISH" ? "🟦 Bull OB" : "🟥 Bear OB"}</span>
                      <span className="opacity-80">{ob.bottom.toFixed(1)} – {ob.top.toFixed(1)}</span>
                    </div>
                  ))
                )}
              </div>
            </TerminalCard>

            {/* PREMIUM / DISCOUNT */}
            <TerminalCard title="MARKET ZONES" className="md:col-span-1">
              <div className="flex flex-col gap-3 font-mono text-xs">
                {symbolData.premiumDiscount ? (
                  <>
                    <div className={cn(
                      "flex items-center justify-between px-3 py-2 rounded border",
                      symbolData.premiumDiscount.zone === "PREMIUM" ? "text-destructive bg-destructive/5 border-destructive/20" :
                      symbolData.premiumDiscount.zone === "DISCOUNT" ? "text-primary bg-primary/5 border-primary/20" :
                      "text-muted-foreground bg-muted/20 border-border"
                    )}>
                      <span>CURRENT ZONE</span>
                      <span className="font-bold">{symbolData.premiumDiscount.zone}</span>
                    </div>
                    <div className="space-y-1 text-muted-foreground">
                      <div className="flex justify-between px-1">
                        <span>Range High</span>
                        <span className="text-destructive">{symbolData.premiumDiscount.rangeHigh.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between px-1">
                        <span>Mid (EQ)</span>
                        <span className="text-foreground/70">{symbolData.premiumDiscount.mid.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between px-1">
                        <span>Range Low</span>
                        <span className="text-primary">{symbolData.premiumDiscount.rangeLow.toFixed(1)}</span>
                      </div>
                    </div>
                    {symbolData.equalLevels.length > 0 && (
                      <div className="border-t border-border pt-2">
                        <p className="text-[10px] text-muted-foreground mb-1">EQUAL LEVELS</p>
                        {symbolData.equalLevels.slice(-3).map((eq, i) => (
                          <div key={i} className={cn(
                            "flex justify-between px-1 py-0.5",
                            eq.type === "EQH" ? "text-yellow-400" : "text-orange-400"
                          )}>
                            <span>{eq.type}</span>
                            <span>{eq.price.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic text-center py-4">Loading zones...</p>
                )}
              </div>
            </TerminalCard>
          </div>

          {/* BOTTOM TABLES */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
            <TerminalCard title="OPEN POSITIONS">
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono text-left">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="pb-3 font-normal">SYMBOL</th>
                      <th className="pb-3 font-normal">DIR</th>
                      <th className="pb-3 font-normal">ENTRY</th>
                      <th className="pb-3 font-normal">SL / TP</th>
                      <th className="pb-3 font-normal text-right">TIME</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {openTrades.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs italic">NO OPEN POSITIONS</td>
                      </tr>
                    ) : (
                      openTrades.map(t => (
                        <tr key={t.id} className="hover:bg-muted/30 transition-colors group">
                          <td className="py-3 font-semibold text-foreground">{t.symbol}</td>
                          <td className="py-3">
                            <span className={cn("px-2 py-0.5 rounded text-[10px]", t.direction === "BUY" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive")}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-3">{safeFormatCurrency(t.entry, (t.entry ?? 0) < 100 ? 2 : 0)}</td>
                          <td className="py-3 text-[10px] text-muted-foreground">
                            <span className="text-destructive">{safeFormatCurrency(t.sl, 0)}</span>
                            {" / "}
                            <span className="text-primary">{safeFormatCurrency(t.tp, 0)}</span>
                          </td>
                          <td className="py-3 text-right text-[10px] text-muted-foreground">
                            {t.openedAt ? new Date(t.openedAt).toLocaleTimeString() : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TerminalCard>

            <TerminalCard title="RECENT HISTORY">
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono text-left">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="pb-3 font-normal">SYMBOL</th>
                      <th className="pb-3 font-normal">RESULT</th>
                      <th className="pb-3 font-normal">PNL</th>
                      <th className="pb-3 font-normal text-right">CLOSED</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {recentTrades.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-muted-foreground text-xs italic">NO TRADE HISTORY</td>
                      </tr>
                    ) : (
                      recentTrades.slice(0, 5).map(t => (
                        <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 font-semibold text-foreground flex items-center gap-2">
                            {t.status === "WIN"
                              ? <CheckCircle2 className="w-4 h-4 text-primary" />
                              : <XCircle className="w-4 h-4 text-destructive" />}
                            {t.symbol}
                          </td>
                          <td className="py-3">
                            <span className={cn("text-xs", t.status === "WIN" ? "text-primary" : "text-destructive")}>
                              {t.status}
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={cn("px-2 py-1 rounded bg-background border",
                              (t.pnlPct ?? 0) > 0 ? "border-primary/30 text-primary" : "border-destructive/30 text-destructive"
                            )}>
                              {formatPercentage(t.pnlPct ?? 0)}
                            </span>
                          </td>
                          <td className="py-3 text-right text-[10px] text-muted-foreground">
                            {t.closedAt ? new Date(t.closedAt).toLocaleTimeString() : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TerminalCard>
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <ErrorBoundary>
      <DashboardInner />
    </ErrorBoundary>
  );
}
