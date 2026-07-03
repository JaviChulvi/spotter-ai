"use client";
// Live overlay on the video: current rep count (pops on each new rep), a
// live/done status pill, and the most recent rep's depth.
import { useSquatSession } from "@/lib/store/squatSession";

const DEPTH_CHIP: Record<string, { label: string; cls: string }> = {
  below_parallel: { label: "Below parallel", cls: "bg-emerald-500/85 text-white" },
  parallel: { label: "Parallel", cls: "bg-emerald-500/85 text-white" },
  above_parallel: { label: "Above parallel", cls: "bg-amber-500/90 text-black" },
};

export default function SquatRepHud() {
  const analysis = useSquatSession((s) => s.analysis);
  const processing = useSquatSession((s) => s.processing);
  const finalId = useSquatSession((s) => s.finalId);
  const provider = useSquatSession((s) => s.provider);

  const reps = analysis?.repCount ?? 0;
  const last = analysis?.reps.at(-1);
  const chip = last ? DEPTH_CHIP[last.depth] : null;

  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
      <div className="flex items-baseline gap-2 rounded-xl bg-black/55 px-3 py-2 backdrop-blur-md">
        <span
          key={reps}
          className="rep-pop text-4xl font-bold leading-none tabular-nums text-white"
        >
          {reps}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/70">
          reps
        </span>
      </div>

      {chip && (
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
        >
          {chip.label} · {last!.minKneeAngle.toFixed(0)}°
        </span>
      )}

      {processing ? (
        <span className="flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-md">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          live{provider ? ` · ${provider}` : ""}
        </span>
      ) : (
        finalId > 0 &&
        reps > 0 && (
          <span className="rounded-md bg-emerald-500/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            ✓ set complete
          </span>
        )
      )}
    </div>
  );
}
