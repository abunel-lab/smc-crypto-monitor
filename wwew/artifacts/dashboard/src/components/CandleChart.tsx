import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from 'lightweight-charts';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TerminalCard } from '@/components/TerminalUI';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PointData {
  index: number;
  price: number;
  time: number;
}

interface FvgData {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  time: number;
}

interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  time: number;
  broken: boolean;
}

interface EqualLevel {
  type: 'EQH' | 'EQL';
  price: number;
  time: number;
}

interface PremiumDiscount {
  zone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  mid: number;
  rangeHigh: number;
  rangeLow: number;
}

interface ChartResponse {
  candles: CandleData[];
  bos: PointData[];
  choch: PointData[];
  fvg: FvgData[];
  orderBlocks?: OrderBlock[];
  equalLevels?: EqualLevel[];
  premiumDiscount?: PremiumDiscount;
}

interface OpenTrade {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  status: string;
  openedAt: number;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '4h'];

export function CandleChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const extraSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const activePriceLinesRef = useRef<IPriceLine[]>([]);

  const [tf, setTf] = useState('5m');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pdZone, setPdZone] = useState<string>('');
  const [activeTrade, setActiveTrade] = useState<OpenTrade | null>(null);

  const tfRef = useRef(tf);
  tfRef.current = tf;

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const applyData = (data: ChartResponse) => {
    if (!chartRef.current || !candleSeriesRef.current) return;

    const sorted = [...data.candles].sort((a, b) => a.time - b.time);
    candleSeriesRef.current.setData(
      sorted.map((c) => ({ ...c, time: c.time as Time }))
    );

    extraSeriesRef.current.forEach((s) => chartRef.current!.removeSeries(s));
    extraSeriesRef.current = [];

    const lastTime = sorted.length > 0 ? sorted[sorted.length - 1].time : 0;

    // ── BOS lines (green dashed) ──────────────────────────────────────────────
    data.bos?.forEach((b) => {
      if (b.time >= lastTime) return;
      const s = chartRef.current!.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData([
        { time: b.time as Time, value: b.price },
        { time: lastTime as Time, value: b.price },
      ]);
      extraSeriesRef.current.push(s);
    });

    // ── CHoCH lines (yellow dashed) ───────────────────────────────────────────
    data.choch?.forEach((c) => {
      if (c.time >= lastTime) return;
      const s = chartRef.current!.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData([
        { time: c.time as Time, value: c.price },
        { time: lastTime as Time, value: c.price },
      ]);
      extraSeriesRef.current.push(s);
    });

    // ── FVG zones (thin band: top + bottom lines) ─────────────────────────────
    data.fvg?.forEach((f) => {
      const color = f.type === 'bullish' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)';
      const endTime = Math.min(f.time + 60 * 20, lastTime);
      if (f.time >= endTime) return;

      const top = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      top.setData([
        { time: f.time as Time, value: f.top },
        { time: endTime as Time, value: f.top },
      ]);

      const bot = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      bot.setData([
        { time: f.time as Time, value: f.bottom },
        { time: endTime as Time, value: f.bottom },
      ]);

      extraSeriesRef.current.push(top, bot);
    });

    // ── Order Blocks (solid thicker band) ────────────────────────────────────
    data.orderBlocks?.forEach((ob) => {
      if (ob.broken) return;
      const color = ob.type === 'BULLISH' ? 'rgba(59,130,246,0.7)' : 'rgba(168,85,247,0.7)';
      const startTime = ob.time;
      if (startTime >= lastTime) return;

      const topLine = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      topLine.setData([
        { time: startTime as Time, value: ob.top },
        { time: lastTime as Time, value: ob.top },
      ]);

      const botLine = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      botLine.setData([
        { time: startTime as Time, value: ob.bottom },
        { time: lastTime as Time, value: ob.bottom },
      ]);

      extraSeriesRef.current.push(topLine, botLine);
    });

    // ── Equal Highs / Lows (dotted white/orange lines) ────────────────────────
    data.equalLevels?.forEach((eq) => {
      if (eq.time >= lastTime) return;
      const color = eq.type === 'EQH' ? 'rgba(251,191,36,0.8)' : 'rgba(251,146,60,0.8)';
      const s = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData([
        { time: eq.time as Time, value: eq.price },
        { time: lastTime as Time, value: eq.price },
      ]);
      extraSeriesRef.current.push(s);
    });

    // ── Premium / Discount mid line ───────────────────────────────────────────
    if (data.premiumDiscount && data.premiumDiscount.mid > 0) {
      const pd = data.premiumDiscount;
      const midColor = 'rgba(148,163,184,0.4)';
      const firstTime = sorted[0]?.time ?? lastTime;

      const midLine = chartRef.current!.addSeries(LineSeries, {
        color: midColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      midLine.setData([
        { time: firstTime as Time, value: pd.mid },
        { time: lastTime as Time, value: pd.mid },
      ]);
      extraSeriesRef.current.push(midLine);

      setPdZone(pd.zone);
    }

    // ── BOS / CHoCH markers (arrows on candles) ───────────────────────────────
    type MarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';
    const markers: {
      time: Time;
      position: 'aboveBar' | 'belowBar';
      color: string;
      shape: MarkerShape;
      text: string;
    }[] = [];

    data.bos?.forEach((b) => {
      if (b.time > 0 && b.time <= lastTime) {
        markers.push({
          time: b.time as Time,
          position: 'aboveBar',
          color: '#22c55e',
          shape: 'arrowDown',
          text: 'BOS',
        });
      }
    });

    data.choch?.forEach((c) => {
      if (c.time > 0 && c.time <= lastTime) {
        markers.push({
          time: c.time as Time,
          position: 'belowBar',
          color: '#eab308',
          shape: 'arrowUp',
          text: 'CHoCH',
        });
      }
    });

    if (markers.length > 0) {
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      (candleSeriesRef.current as any).setMarkers?.(markers);
    }
  };

  const applyTrade = (trade: OpenTrade | null) => {
    if (!candleSeriesRef.current) return;
    activePriceLinesRef.current.forEach((l) => {
      try { candleSeriesRef.current!.removePriceLine(l); } catch { /* ignore */ }
    });
    activePriceLinesRef.current = [];

    if (!trade) return;

    const isLong = trade.direction === 'LONG';

    const entryLine = candleSeriesRef.current.createPriceLine({
      price: trade.entry,
      color: '#94a3b8',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `${isLong ? '🟢' : '🔴'} ENTRY`,
    });
    const slLine = candleSeriesRef.current.createPriceLine({
      price: trade.sl,
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '🛑 SL',
    });
    const tpLine = candleSeriesRef.current.createPriceLine({
      price: trade.tp,
      color: '#22c55e',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '🎯 TP',
    });

    activePriceLinesRef.current = [entryLine, slLine, tpLine];
  };

  const fetchAndApply = async () => {
    try {
      setError(false);
      const [candleRes, statusRes] = await Promise.all([
        fetch(`/api/candles?symbol=${symbolRef.current}&interval=${tfRef.current}`),
        fetch('/api/monitor/status'),
      ]);
      if (!candleRes.ok) throw new Error('bad candle response');
      const data: ChartResponse = await candleRes.json();
      applyData(data);

      if (statusRes.ok) {
        const status = await statusRes.json();
        const openTrades: OpenTrade[] = Array.isArray(status.openTrades) ? status.openTrades : [];
        const trade = openTrades.find((t) => t.symbol === symbolRef.current && t.status === 'OPEN') ?? null;
        setActiveTrade(trade);
        applyTrade(trade);
      }

      setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      width: containerRef.current.clientWidth,
      height: 580,
      crosshair: { mode: 1 },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candles;

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);

    setLoading(true);
    void fetchAndApply();

    const poll = window.setInterval(() => void fetchAndApply(), 5000);

    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', onResize);
      activePriceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      extraSeriesRef.current = [];
    };
  }, [symbol, tf]);

  const pdColor =
    pdZone === 'PREMIUM' ? 'text-destructive' :
    pdZone === 'DISCOUNT' ? 'text-primary' : 'text-muted-foreground';

  return (
    <TerminalCard className="w-full flex-1">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-foreground">{symbol} · SMC CHART</span>
          {loading && <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />}
          {pdZone && (
            <span className={cn("text-xs font-mono px-2 py-0.5 rounded border", pdColor,
              pdZone === 'PREMIUM' ? 'border-destructive/30 bg-destructive/5' :
              pdZone === 'DISCOUNT' ? 'border-primary/30 bg-primary/5' :
              'border-border bg-muted/30'
            )}>
              {pdZone}
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-background/60 p-1 rounded border border-border">
          {INTERVALS.map((i) => (
            <button
              key={i}
              onClick={() => { setTf(i); setLoading(true); }}
              className={cn(
                'px-3 py-1 text-xs font-mono rounded transition-colors',
                tf === i
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              {i.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-destructive text-xs font-mono mb-2">
          ⚠ Chart data unavailable — retrying…
        </p>
      )}

      <div className="w-full border border-border/40 rounded overflow-hidden">
        <div ref={containerRef} />
      </div>

      {activeTrade && (
        <div className="mt-3 flex flex-wrap items-center gap-3 p-3 rounded-lg border font-mono text-xs bg-muted/10"
          style={{ borderColor: activeTrade.direction === 'LONG' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }}>
          <span className={cn("font-bold px-2 py-0.5 rounded text-[10px]",
            activeTrade.direction === 'LONG' ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
          )}>
            {activeTrade.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span className="text-muted-foreground">Entry <span className="text-foreground">${activeTrade.entry.toFixed(activeTrade.entry < 10 ? 4 : 2)}</span></span>
          <span className="text-destructive">SL ${activeTrade.sl.toFixed(activeTrade.sl < 10 ? 4 : 2)}</span>
          <span className="text-primary">TP ${activeTrade.tp.toFixed(activeTrade.tp < 10 ? 4 : 2)}</span>
          <span className="ml-auto text-muted-foreground opacity-60">OPEN TRADE</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-mono text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#22c55e]" /> BOS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#eab308]" /> CHoCH
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-green-500/20 border border-green-500/40 rounded-sm" /> Bull FVG
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-red-500/20 border border-red-500/40 rounded-sm" /> Bear FVG
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-solid border-[#3b82f6]" /> Bull OB
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-solid border-[#a855f7]" /> Bear OB
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dotted border-[#fbbf24]" /> EQH
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dotted border-[#fb923c]" /> EQL
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed border-slate-400/40" /> EQ Mid
        </span>
      </div>
    </TerminalCard>
  );
}
