import { useState, useEffect, useRef } from "react";
import { Clock } from "lucide-react";

export function ElapsedTimer({ isRunning }: { isRunning: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isRunning) {
      setFinalTime(null);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      startTimeRef.current = Date.now();
      setElapsed(0);

      const tick = () => {
        if (startTimeRef.current) {
          setElapsed(Date.now() - startTimeRef.current);
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      return () => {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
      };
    } else {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (startTimeRef.current && elapsed > 0) {
        setFinalTime(elapsed);
        hideTimerRef.current = setTimeout(() => {
          setFinalTime(null);
          setElapsed(0);
        }, 5000);
      }
      startTimeRef.current = null;
    }
  }, [isRunning]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const displayMs = isRunning ? elapsed : finalTime;
  if (displayMs === null || displayMs === 0) return null;

  const seconds = (displayMs / 1000).toFixed(1);

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-mono ml-1 transition-opacity duration-500 ${
        isRunning ? "text-muted-foreground" : "text-green-600 dark:text-green-400"
      }`}
      data-testid="text-elapsed-timer"
    >
      <Clock className="h-3.5 w-3.5" />
      {isRunning ? `${seconds}s` : `Done in ${seconds}s`}
    </span>
  );
}
