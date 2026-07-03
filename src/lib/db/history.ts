// Client-side set history in IndexedDB (via idb). No backend, fully private.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SquatSetSummary } from "@/lib/coach/schema";

export interface HistoryRecord {
  id?: number;
  date: number; // epoch ms
  summary: SquatSetSummary;
}

interface SquatDB extends DBSchema {
  sets: {
    key: number;
    value: HistoryRecord;
    indexes: { "by-date": number };
  };
}

let dbPromise: Promise<IDBPDatabase<SquatDB>> | null = null;

function db(): Promise<IDBPDatabase<SquatDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SquatDB>("squat-ai", 1, {
      upgrade(d) {
        const store = d.createObjectStore("sets", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("by-date", "date");
      },
    });
  }
  return dbPromise;
}

export async function saveSet(summary: SquatSetSummary): Promise<number> {
  const d = await db();
  return d.add("sets", { date: Date.now(), summary });
}

export async function allSets(): Promise<HistoryRecord[]> {
  const d = await db();
  const records = await d.getAllFromIndex("sets", "by-date");
  return records.reverse(); // newest first
}

export async function deleteSet(id: number): Promise<void> {
  const d = await db();
  await d.delete("sets", id);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear("sets");
}
