// Global client state for one squat analysis session (Zustand).
import { create } from "zustand";
import type { SquatSetAnalysis } from "@/lib/analysis/squat/analyze";

export type ModelStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing" // model file not found (needs export)
  | "error";

interface SquatSessionState {
  fileName: string | null;
  modelStatus: ModelStatus;
  modelError: string | null;
  provider: string | null; // webgpu | wasm
  processing: boolean; // a clip is currently playing + being analyzed
  analysis: SquatSetAnalysis | null; // refreshed live during playback, final at the end
  finalId: number; // bumps once when a set finishes (auto-coach trigger)

  setFileName: (n: string | null) => void;
  setModelStatus: (s: ModelStatus, error?: string | null) => void;
  setProvider: (p: string) => void;
  setProcessing: (p: boolean) => void;
  setLiveAnalysis: (a: SquatSetAnalysis) => void; // live tick, no coach trigger
  finalizeAnalysis: (a: SquatSetAnalysis) => void; // end of set → triggers coach
  resetForNewClip: () => void;
}

export const useSquatSession = create<SquatSessionState>((set) => ({
  fileName: null,
  modelStatus: "idle",
  modelError: null,
  provider: null,
  processing: false,
  analysis: null,
  finalId: 0,

  setFileName: (n) => set({ fileName: n }),
  setModelStatus: (s, error = null) => set({ modelStatus: s, modelError: error }),
  setProvider: (p) => set({ provider: p }),
  setProcessing: (p) => set({ processing: p }),
  setLiveAnalysis: (a) => set({ analysis: a }),
  finalizeAnalysis: (a) =>
    set((st) => ({ analysis: a, processing: false, finalId: st.finalId + 1 })),
  resetForNewClip: () => set({ analysis: null, processing: true }),
}));
