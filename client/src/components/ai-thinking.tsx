/**
 * AI Thinking/Loading Indicator Component
 * 
 * Displays a visual loading state shown during AI operations including UPIF generation,
 * chat conversations, and PDF summarization. Features a brain icon with an animated
 * spinner overlay and a live elapsed timer showing how long the operation has been running.
 */

import { useState, useEffect, useRef } from "react";
import { Brain, Loader2 } from "lucide-react";

/**
 * Props for the AiThinking component
 * @property isActive - Toggles visibility of the thinking indicator
 * @property label - Customizable message text (default: "AI is thinking")
 * @property compact - Renders smaller inline version vs. full centered layout
 */
interface AiThinkingProps {
  isActive: boolean;
  label?: string;
  compact?: boolean;
}

/**
 * Custom hook that tracks elapsed time while AI operation is active.
 * Records seconds elapsed since activation, updating every second.
 * Automatically resets to 0 when the operation is deactivated.
 */
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

  // Compact render path: inline version used during operations like re-generation
  // Displays spinner, label, and timer in a single row with minimal space
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ai-thinking-compact">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>{label}</span>
        <span className="tabular-nums text-xs opacity-70">{formatTime(elapsed)}</span>
      </div>
    );
  }

  // Full render path: centered layout used for initial generation
  // Displays brain icon with animated spinner overlay, label, and elapsed timer
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
