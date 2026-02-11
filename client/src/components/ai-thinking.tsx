import { useState, useEffect, useRef } from "react";
import { Brain, Loader2 } from "lucide-react";

interface AiThinkingProps {
  isActive: boolean;
  label?: string;
  compact?: boolean;
}

function useElapsedTime(isActive: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isActive) {
      startRef.current = Date.now();
      setElapsed(0);

      const interval = setInterval(() => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      startRef.current = null;
      setElapsed(0);
    }
  }, [isActive]);

  return elapsed;
}

export function AiThinking({ isActive, label = "AI is thinking", compact = false }: AiThinkingProps) {
  const elapsed = useElapsedTime(isActive);

  if (!isActive) return null;

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ai-thinking-compact">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>{label}</span>
        <span className="tabular-nums text-xs opacity-70">{formatTime(elapsed)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4" data-testid="ai-thinking-indicator">
      <div className="relative">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Brain className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-background border-2 border-primary/20 flex items-center justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium" data-testid="ai-thinking-label">{label}</p>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="ai-thinking-timer">
          Elapsed: {formatTime(elapsed)}
        </p>
      </div>
    </div>
  );
}
