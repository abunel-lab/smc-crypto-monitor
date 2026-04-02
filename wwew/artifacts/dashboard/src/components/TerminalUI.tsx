import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// --- Card Component ---
export function TerminalCard({ children, className, title, glow = false }: { children: React.ReactNode, className?: string, title?: string, glow?: boolean }) {
  return (
    <div className={cn(
      "glass-panel rounded-xl overflow-hidden flex flex-col relative group transition-all duration-300",
      glow && "shadow-[0_0_15px_rgba(0,255,163,0.1)] border-primary/20",
      className
    )}>
      {title && (
        <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{title}</span>
          {glow && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}

// --- Badge Component ---
export function Badge({ children, variant = "default", className }: { children: React.ReactNode, variant?: "default" | "success" | "danger" | "warning" | "neutral", className?: string }) {
  const variants = {
    default: "bg-muted text-foreground border-border",
    success: "bg-primary/10 text-primary border-primary/30",
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    neutral: "bg-gray-500/10 text-gray-400 border-gray-500/30"
  };

  return (
    <span className={cn("px-2.5 py-1 rounded-md text-xs font-mono border whitespace-nowrap", variants[variant], className)}>
      {children}
    </span>
  );
}

// --- Flashing Value Component ---
export function LiveValue({ value, format, className }: { value: number, format: (v: number) => string, className?: string }) {
  const prev = useRef(value);
  const [colorClass, setColorClass] = useState("");

  useEffect(() => {
    if (value > prev.current) {
      setColorClass("text-primary drop-shadow-[0_0_8px_rgba(0,255,163,0.5)]");
      const t = setTimeout(() => setColorClass(""), 1000);
      prev.current = value;
      return () => clearTimeout(t);
    } else if (value < prev.current) {
      setColorClass("text-destructive drop-shadow-[0_0_8px_rgba(255,51,102,0.5)]");
      const t = setTimeout(() => setColorClass(""), 1000);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span className={cn("transition-all duration-300", colorClass, className)}>
      {format(value)}
    </span>
  );
}

// --- UTC Clock ---
export function UtcClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 text-muted-foreground font-mono text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      {time.toISOString().substring(11, 19)} UTC
    </div>
  );
}
