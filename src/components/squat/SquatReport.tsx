"use client";
// Live + final set stats (center column). Fixed-height chart + table areas so the
// panel is "big" from the start and never grows/jumps as reps are added.
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSquatSession } from "@/lib/store/squatSession";
import type { Zone, Depth } from "@/lib/analysis/squat/form";

const ZONE_LABEL: Record<Zone, string> = {
  bottom: "Out of the hole",
  mid: "Mid-range",
  lockout: "Near lockout",
  none: "—",
};

const DEPTH_DOT: Record<Depth, string> = {
  below_parallel: "bg-emerald-500",
  parallel: "bg-emerald-500",
  above_parallel: "bg-amber-500",
};

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 text-2xl font-bold tabular-nums ${accent ? "text-accent" : ""}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}

export default function SquatReport() {
  const analysis = useSquatSession((s) => s.analysis);
  const processing = useSquatSession((s) => s.processing);
  const finalId = useSquatSession((s) => s.finalId);

  // Idle: nothing analyzed yet and not playing. Same min-height as the active
  // panel so switching in doesn't shift the layout.
  if (!analysis && !processing) {
    return (
      <section className="flex min-h-[44rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
        <div className="text-3xl">🏋️</div>
        <h2 className="font-semibold">Your set stats will appear here</h2>
        <p className="max-w-xs text-sm text-muted">
          Choose a squat clip and press play. Reps, depth and bar speed update
          live, then the coach reviews the set.
        </p>
      </section>
    );
  }

  const reps = analysis?.reps ?? [];
  const repCount = analysis?.repCount ?? 0;
  const done = finalId > 0 && !processing;
  const allDepth = repCount > 0 && (analysis?.formFlags.repsAtDepth ?? 0) === repCount;
  const chartData = reps.map((r) => ({ rep: r.index + 1, knee: r.minKneeAngle }));

  return (
    <section className="flex min-h-[44rem] flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {done ? "Set summary" : "Live stats"}
        </h2>
        {!done && processing && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            analyzing
          </span>
        )}
      </div>

      {/* rep dots — one per completed rep, single scrolling row (fixed height) */}
      <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-x-auto">
        {repCount > 0 ? (
          reps.map((r) => (
            <span
              key={r.index}
              title={`Rep ${r.index + 1}: ${r.minKneeAngle.toFixed(0)}°`}
              className={`${DEPTH_DOT[r.depth]} ${r.index === repCount - 1 ? "rep-pop" : ""} flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold text-white`}
            >
              {r.index + 1}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">Detecting reps…</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Reps" value={String(repCount)} accent />
        <Stat
          label="To depth"
          value={`${analysis?.formFlags.repsAtDepth ?? 0}/${repCount}`}
          hint={allDepth ? "all below parallel" : "hit parallel"}
          accent={allDepth}
        />
        <Stat
          label="Avg knee"
          value={`${(analysis?.formFlags.meanMinKneeAngle ?? 0).toFixed(0)}°`}
          hint="lower = deeper"
        />
        <Stat
          label="Vel. loss"
          value={`${(analysis?.fatigue.velocityLossPct ?? 0).toFixed(0)}%`}
          hint="fatigue"
        />
      </div>

      {/* depth chart — fixed height, reserved even before reps exist */}
      <div className="shrink-0">
        <h3 className="mb-1 text-xs font-medium text-muted">
          Depth per rep — knee angle (lower = deeper)
        </h3>
        <div className="h-[160px]">
          {repCount > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="rep" fontSize={11} tickLine={false} />
                <YAxis fontSize={11} domain={[0, 180]} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                />
                <ReferenceLine
                  y={100}
                  stroke="var(--warn)"
                  strokeDasharray="4 4"
                  label={{ value: "parallel", fontSize: 10, fill: "var(--warn)", position: "insideTopRight" }}
                />
                <Line
                  type="monotone"
                  dataKey="knee"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                  name="Min knee angle"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">
              Depth per rep charts here as you squat
            </div>
          )}
        </div>
      </div>

      {/* per-rep table — fixed height, scrolls instead of growing */}
      <div className="h-64 shrink-0 overflow-y-auto rounded-lg border border-border">
        {repCount > 0 ? (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Depth</th>
                <th className="px-2 py-1.5">Knee</th>
                <th className="px-2 py-1.5">Down</th>
                <th className="px-2 py-1.5">Up</th>
                <th className="px-2 py-1.5">Sticky</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr
                  key={r.index}
                  className={`border-t border-border ${
                    r.index === repCount - 1 && processing ? "bg-accent-soft" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 font-medium tabular-nums">{r.index + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${DEPTH_DOT[r.depth]}`} />
                      {!r.atLeastParallel ? "Shallow" : "Below ||"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{r.minKneeAngle.toFixed(0)}°</td>
                  <td className="px-2 py-1.5 tabular-nums">{r.eccentricS.toFixed(1)}s</td>
                  <td className="px-2 py-1.5 tabular-nums">{r.concentricS.toFixed(1)}s</td>
                  <td className="px-2 py-1.5 text-xs">{ZONE_LABEL[r.stickyZone]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Per-rep breakdown appears here
          </div>
        )}
      </div>

      {/* footer stats — reserved fixed height (available live too), one line */}
      <div className="mt-auto flex h-5 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-muted">
        {repCount > 0 && (
          <>
            <span>
              Consistency{" "}
              {((analysis?.formFlags.depthConsistency ?? 0) * 100).toFixed(0)}%
            </span>
            <span>·</span>
            <span>Lean {(analysis?.formFlags.maxTorsoLean ?? 0).toFixed(0)}°</span>
            <span>·</span>
            <span>
              Detection {((analysis?.detectionConfidence ?? 0) * 100).toFixed(0)}%
            </span>
          </>
        )}
      </div>

      {done && repCount === 0 && (
        <p className="text-sm text-muted">
          No complete squat reps were detected. Try a side-on clip of the full set.
        </p>
      )}
    </section>
  );
}
