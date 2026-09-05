"use client";

import { RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ReplayButtonProps {
  onReplay: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

type ReplayState = "idle" | "confirm" | "loading" | "success" | "error";

export function ReplayButton({ onReplay, disabled = false, compact = false }: ReplayButtonProps) {
  const [state, setState] = useState<ReplayState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function runReplay() {
    if (state === "loading") return;
    setState("loading");
    try {
      await onReplay();
      setState("success");
      resetTimer.current = setTimeout(() => setState("idle"), 3500);
    } catch {
      setState("error");
    }
  }

  if (state === "confirm") {
    return (
      <div className={`replay-confirm ${compact ? "replay-confirm--compact" : ""}`} role="group" aria-label="Confirm demo replay">
        <p>Replace the current synthetic run?</p>
        <div>
          <button className="button button--ghost" type="button" onClick={() => setState("idle")}>
            <X size={16} aria-hidden="true" /> Cancel
          </button>
          <button className="button button--primary" type="button" onClick={runReplay}>
            <RotateCcw size={16} aria-hidden="true" /> Confirm replay
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="replay-action">
      <button
        className={`button button--primary ${compact ? "button--compact" : ""}`}
        type="button"
        disabled={disabled || state === "loading"}
        onClick={() => state === "error" ? void runReplay() : setState("confirm")}
        aria-describedby={state === "error" ? "replay-error" : undefined}
      >
        {state === "loading" ? (
          <><span className="spinner" aria-hidden="true" /> Running evaluation…</>
        ) : state === "success" ? (
          <><Sparkles size={17} aria-hidden="true" /> Demo refreshed</>
        ) : state === "error" ? (
          <><RotateCcw size={17} aria-hidden="true" /> Retry replay</>
        ) : (
          <><RotateCcw size={17} aria-hidden="true" /> Replay 60-case demo</>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "success" ? "Synthetic demo replay completed." : ""}
      </span>
      {state === "error" ? <p id="replay-error" className="inline-error">Replay failed. Your previous run is unchanged.</p> : null}
    </div>
  );
}
