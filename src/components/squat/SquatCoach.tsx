"use client";
// Automatically requests structured coaching from /api/coach (streamed) once,
// when a squat set finishes, and renders it. Feedback is tagged with the set it
// belongs to, and the panel hides while a new clip is playing.
import { useEffect, useRef, useState } from "react";
import { useSquatSession } from "@/lib/store/squatSession";
import { toSquatSetSummary } from "@/lib/analysis/squat/summary";
import type { CoachFeedback as Feedback } from "@/lib/coach/schema";

type State =
  | { kind: "idle" }
  | { kind: "loading"; id: number }
  | { kind: "done"; id: number; feedback: Feedback }
  | { kind: "error"; id: number; message: string };

export default function SquatCoach() {
  const finalId = useSquatSession((s) => s.finalId);
  const processing = useSquatSession((s) => s.processing);
  const [state, setState] = useState<State>({ kind: "idle" });
  const requested = useRef(0);

  async function ask(id: number = useSquatSession.getState().finalId) {
    const current = useSquatSession.getState().analysis;
    if (!current || current.repCount === 0) return;
    setState({ kind: "loading", id });
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toSquatSetSummary(current)),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      }
      const parsed = JSON.parse(text) as Feedback | { error: string };
      if ("error" in parsed) setState({ kind: "error", id, message: parsed.error });
      else setState({ kind: "done", id, feedback: parsed });
    } catch (err) {
      setState({
        kind: "error",
        id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // A set finished: fetch coaching exactly once for it.
  useEffect(() => {
    if (finalId > 0 && finalId !== requested.current) {
      requested.current = finalId;
      void ask(finalId);
    }
  }, [finalId]);

  // Only show feedback that belongs to the current, finished set.
  const active = !processing && state.kind !== "idle" && state.id === finalId;
  const showActions = active && (state.kind === "done" || state.kind === "error");

  return (
    <section className="flex min-h-[16rem] flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-accent">🧠</span> Coach feedback
        </h2>
        {showActions && (
          <button
            onClick={() => ask()}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition hover:border-accent hover:text-accent"
          >
            Re-run
          </button>
        )}
      </div>

      {!active && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
          <span className="text-2xl">💬</span>
          {processing
            ? "Analyzing your set — coaching runs automatically when the clip ends."
            : "Finish a set and the coach will review your reps here."}
        </div>
      )}

      {active && state.kind === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Reviewing your set…
        </div>
      )}

      {active && state.kind === "error" && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {state.message}
        </p>
      )}

      {active && state.kind === "done" && <FeedbackView f={state.feedback} />}
    </section>
  );
}

function FeedbackView({ f }: { f: Feedback }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="leading-relaxed">{f.summary}</p>

      {f.priorities.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Priorities
          </h3>
          <ol className="flex flex-col gap-2">
            {f.priorities.map((p, i) => (
              <li
                key={i}
                className="rounded-lg border border-border bg-surface-2/50 p-2.5"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium">{p.issue}</div>
                    <div className="text-muted">{p.why}</div>
                    <div className="mt-1 font-medium text-accent">Cue: {p.cue}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {f.accessory_recommendations.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Accessory work
          </h3>
          <ul className="list-disc pl-5">
            {f.accessory_recommendations.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.movement}</span> — {a.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {f.fatigue_note && (
        <p className="text-muted">
          <span className="font-medium text-foreground">Fatigue: </span>
          {f.fatigue_note}
        </p>
      )}

      {f.safety_flags.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            ⚠ Safety:{" "}
          </span>
          {f.safety_flags.join("; ")}
        </div>
      )}
    </div>
  );
}
