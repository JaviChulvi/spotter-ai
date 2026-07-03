"use client";
// Compact pose-model status: a small pill when loading/ready, a full card with
// the one-time export command when the model is missing or failed.
import { useSquatSession } from "@/lib/store/squatSession";

export default function SquatModelStatus() {
  const status = useSquatSession((s) => s.modelStatus);
  const error = useSquatSession((s) => s.modelError);
  const provider = useSquatSession((s) => s.provider);

  if (status === "idle" || status === "loading") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
        Loading pose model…
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Model ready{provider ? ` · ${provider}` : ""}
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium text-amber-700 dark:text-amber-300">
        {status === "missing"
          ? "Pose model not found."
          : "Pose model failed to load."}
      </p>
      {error && <p className="mt-1 text-muted">{error}</p>}
      <p className="mt-2 text-muted">Export it once, then reload:</p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-black/80 p-2 text-xs text-white">
        conda activate benchpress{"\n"}yolo export model=yolo26n-pose.pt
        format=onnx opset=13{"\n"}mv yolo26n-pose.onnx public/models/
      </pre>
    </div>
  );
}
