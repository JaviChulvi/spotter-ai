"use client";
// Set history + progress dashboards, all from IndexedDB (client-only).
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { allSets, clearAll, deleteSet, type HistoryRecord } from "@/lib/db/history";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    setRecords(await allSets());
    setLoaded(true);
  }
  useEffect(() => {
    let alive = true;
    void allSets().then((r) => {
      if (!alive) return;
      setRecords(r);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const progress = [...records]
    .reverse() // oldest -> newest for a left-to-right trend
    .map((r, i) => ({
      n: i + 1,
      reps: r.summary.reps,
      velocityLoss: r.summary.fatigue.velocity_loss_pct,
    }));

  const zoneCounts: Record<string, number> = {};
  for (const r of records) {
    const z = r.summary.sticky_point.dominant_zone;
    zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
  }
  const zoneData = Object.entries(zoneCounts).map(([zone, count]) => ({
    zone,
    count,
  }));

  function exportJson() {
    const blob = new Blob([JSON.stringify(records, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "squat-history.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">History</h1>
        <Link
          href="/"
          className="shrink-0 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Analyze
        </Link>
      </header>

      {loaded && records.length === 0 && (
        <p className="text-sm text-foreground/60">
          No saved sets yet. Analyze a clip and it will appear here.
        </p>
      )}

      {records.length > 0 && (
        <>
          <div className="flex gap-2">
            <button
              onClick={exportJson}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
            >
              Export JSON
            </button>
            <button
              onClick={async () => {
                await clearAll();
                void refresh();
              }}
              className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
            >
              Clear all
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground/70">
                Velocity loss over sessions (%)
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={progress}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="n" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="velocityLoss"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground/70">
                Sticky-zone frequency
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={zoneData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="zone" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <ul className="flex flex-col gap-2">
            {records.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-black/10 p-3 text-sm dark:border-white/15"
              >
                <div>
                  <div className="font-medium">{r.summary.reps} reps</div>
                  <div className="text-foreground/60">
                    {fmtDate(r.date)} · sticky:{" "}
                    {r.summary.sticky_point.dominant_zone} · vel loss{" "}
                    {r.summary.fatigue.velocity_loss_pct.toFixed(0)}%
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (r.id != null) await deleteSet(r.id);
                    void refresh();
                  }}
                  className="text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
