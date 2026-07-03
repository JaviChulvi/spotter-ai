"use client";
// Upload a squat clip -> play it -> stream frames to the shared pose worker ->
// draw the skeleton overlay + a live HUD -> re-analyze the frames so far every
// few frames (so the stats/chart on the right update rep-by-rep) -> run the
// final analysis when playback ends (which triggers the coach).
import { useCallback, useEffect, useRef } from "react";
import { Frame, Keypoints, SKELETON } from "@/lib/analysis/keypoints";
import { analyzeSquatSet } from "@/lib/analysis/squat/analyze";
import { toSquatSetSummary } from "@/lib/analysis/squat/summary";
import { KEYPOINT_CONF_THRESHOLD } from "@/lib/config";
import { useSquatSession } from "@/lib/store/squatSession";
import { saveSet } from "@/lib/db/history";
import type { OutMsg } from "@/workers/pose.worker";
import SquatRepHud from "./SquatRepHud";

type VideoRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const LIVE_EVERY_FRAMES = 8; // re-analyze the set this often during playback

function classifyModelError(msg: string): "missing" | "error" {
  return /404|fetch|not found|failed to load|no available|load model|status 4/i.test(
    msg,
  )
    ? "missing"
    : "error";
}

export default function SquatVideoStage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const busyRef = useRef(false);
  const readyRef = useRef(false);
  const rvfcHandle = useRef<number | null>(null);
  const rafHandle = useRef<number | null>(null);

  const {
    setModelStatus,
    setProvider,
    setLiveAnalysis,
    finalizeAnalysis,
    setFileName,
    resetForNewClip,
  } = useSquatSession.getState();

  // Full-body skeleton (both legs matter for squats): draw every confident edge.
  const draw = useCallback((kp: Keypoints | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!kp) return;

    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.strokeStyle = "rgba(16,185,129,0.92)";
    ctx.lineCap = "round";
    for (const [a, b] of SKELETON) {
      if (kp[a].c > KEYPOINT_CONF_THRESHOLD && kp[b].c > KEYPOINT_CONF_THRESHOLD) {
        ctx.beginPath();
        ctx.moveTo(kp[a].x, kp[a].y);
        ctx.lineTo(kp[b].x, kp[b].y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    const r = Math.max(3, canvas.width / 260);
    kp.forEach((p) => {
      if (p.c <= KEYPOINT_CONF_THRESHOLD) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  const runLive = useCallback(() => {
    setLiveAnalysis(analyzeSquatSet(framesRef.current));
  }, [setLiveAnalysis]);

  const finalize = useCallback(() => {
    const analysis = analyzeSquatSet(framesRef.current);
    finalizeAnalysis(analysis);
    if (analysis.repCount > 0) {
      void saveSet(toSquatSetSummary(analysis)).catch(() => undefined);
    }
  }, [finalizeAnalysis]);

  const capture = useCallback((v: HTMLVideoElement, t: number) => {
    busyRef.current = true;
    createImageBitmap(v)
      .then((bitmap) => {
        workerRef.current?.postMessage(
          { type: "frame", bitmap, t, w: v.videoWidth, h: v.videoHeight },
          [bitmap],
        );
      })
      .catch(() => {
        busyRef.current = false;
      });
  }, []);

  // Worker lifecycle (shared yolo26n-pose worker).
  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/pose.worker.ts", import.meta.url),
    );
    workerRef.current = worker;
    setModelStatus("loading");
    worker.onmessage = (e: MessageEvent<OutMsg>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        readyRef.current = true;
        setProvider(msg.provider);
        setModelStatus("ready");
      } else if (msg.type === "error") {
        readyRef.current = false;
        setModelStatus(classifyModelError(msg.error), msg.error);
      } else if (msg.type === "pose") {
        busyRef.current = false;
        if (msg.kp) {
          framesRef.current.push({ t: msg.t, kp: msg.kp as Keypoints });
          if (framesRef.current.length % LIVE_EVERY_FRAMES === 0) runLive();
          draw(msg.kp as Keypoints);
        } else {
          draw(null);
        }
      }
    };
    worker.onerror = (e) => {
      setModelStatus("error", e.message || "worker failed");
    };
    worker.postMessage({ type: "init" });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [draw, runLive, setModelStatus, setProvider]);

  const startPump = useCallback(() => {
    const v = videoRef.current as VideoRVFC | null;
    if (!v) return;
    if (v.requestVideoFrameCallback) {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        const vid = videoRef.current as VideoRVFC | null;
        if (!vid) return;
        if (!busyRef.current && readyRef.current) capture(vid, meta.mediaTime);
        if (!vid.paused && !vid.ended) {
          rvfcHandle.current = vid.requestVideoFrameCallback!(onFrame);
        }
      };
      rvfcHandle.current = v.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        const vid = videoRef.current;
        if (!vid || vid.paused || vid.ended) return;
        if (!busyRef.current && readyRef.current) capture(vid, vid.currentTime);
        rafHandle.current = requestAnimationFrame(loop);
      };
      rafHandle.current = requestAnimationFrame(loop);
    }
  }, [capture]);

  const stopPump = useCallback(() => {
    const v = videoRef.current as VideoRVFC | null;
    if (rvfcHandle.current != null && v?.cancelVideoFrameCallback) {
      v.cancelVideoFrameCallback(rvfcHandle.current);
    }
    if (rafHandle.current != null) cancelAnimationFrame(rafHandle.current);
    rvfcHandle.current = null;
    rafHandle.current = null;
  }, []);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const v = videoRef.current;
    if (!file || !v) return;
    setFileName(file.name);
    v.src = URL.createObjectURL(file);
    framesRef.current = [];
  };

  const onPlay = () => {
    framesRef.current = [];
    resetForNewClip();
    startPump();
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (v && c) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
  };

  const onEnded = () => {
    stopPump();
    finalize();
  };
  const onPause = () => {
    stopPump();
  };

  useEffect(() => stopPump, [stopPump]);

  return (
    <div className="flex flex-col gap-3">
      <label className="group flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium transition hover:border-accent">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Choose squat clip
        <input type="file" accept="video/*" onChange={onFile} className="hidden" />
      </label>

      <div className="relative mx-auto w-fit overflow-hidden rounded-2xl bg-black shadow-lg ring-1 ring-border">
        <video
          ref={videoRef}
          className="block max-h-[68vh] w-auto max-w-full"
          controls
          playsInline
          muted
          onPlay={onPlay}
          onEnded={onEnded}
          onPause={onPause}
          onLoadedMetadata={onLoadedMetadata}
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        <SquatRepHud />
      </div>

      <p className="text-center text-xs text-muted">
        Film from the side for the most accurate depth. Reps, depth and speed
        update live; coaching runs automatically when the clip ends.
      </p>
    </div>
  );
}
