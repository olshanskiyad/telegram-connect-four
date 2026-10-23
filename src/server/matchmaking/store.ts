import { readFile } from "fs/promises";

import { dataPath } from "../data-dir";
import { parseJsonFile, writeJsonFile } from "../json-file";

import type { MatchmakingEntry } from "./types";

type MatchmakingStore = {
  entries: MatchmakingEntry[];
};

const STORE_FILE = "matchmaking.json";
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<MatchmakingStore> {
  try {
    const raw = await readFile(dataPath(STORE_FILE), "utf8");
    const parsed = parseJsonFile(raw, STORE_FILE) as Partial<MatchmakingStore>;

    if (!parsed.entries || !Array.isArray(parsed.entries)) {
      return { entries: [] };
    }

    return { entries: parsed.entries };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return { entries: [] };
    }

    throw error;
  }
}

async function writeStore(store: MatchmakingStore): Promise<void> {
  await writeJsonFile(dataPath(STORE_FILE), store);
}

async function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = writeQueue;
  let release!: () => void;

  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
}

export async function mutateMatchmakingStore<T>(task: (store: MatchmakingStore) => Promise<T>): Promise<T> {
  return withWriteLock(async () => {
    const store = await readStore();
    const result = await task(store);
    await writeStore(store);
    return result;
  });
}

export async function readMatchmakingStore(): Promise<MatchmakingStore> {
  return readStore();
}

