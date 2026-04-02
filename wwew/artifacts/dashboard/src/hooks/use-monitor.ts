import { useState, useEffect } from "react";
import { useGetMonitorStatus } from "@workspace/api-client-react";

export interface PricePoint {
  time: string;
  price: number;
}

export function useMonitor() {
  // Poll every 2 seconds
  const query = useGetMonitorStatus({
    query: {
      refetchInterval: 2000,
      staleTime: 1000,
    }
  });

  // Accumulate price history client-side for the charts
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});

  useEffect(() => {
    if (query.data?.symbolStatus) {
      const now = new Date();
      const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      
      setHistory(prev => {
        const next = { ...prev };
        let hasChanges = false;

        Object.entries(query.data.symbolStatus).forEach(([sym, status]) => {
          const symHist = next[sym] ? [...next[sym]] : [];
          const last = symHist[symHist.length - 1];
          
          // Only add new point if price changed or it's been a while (simplification: just add every tick for smooth chart)
          symHist.push({ time: timeLabel, price: status.priceOkx });
          
          // Keep last 60 data points (2 mins of history at 2s intervals)
          if (symHist.length > 60) {
            symHist.shift();
          }
          
          next[sym] = symHist;
          hasChanges = true;
        });

        return hasChanges ? next : prev;
      });
    }
  }, [query.data]);

  return {
    ...query,
    priceHistory: history
  };
}
