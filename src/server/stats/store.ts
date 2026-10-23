import { readFile } from 'fs/promises';

import { dataPath } from '../data-dir';
import { parseJsonFile, writeJsonFile } from '../json-file';

import type { StatsStore } from './types';

const STORE_FILE = 'stats.json';
let writeQueue: Promise<void> = Promise.resolve();

function createEmptyStore(): StatsStore {
  return {
    updatedAt: new Date().toISOString(),
    users: {},
    appliedRooms: {}
  };
}

function normalizeStore(value: unknown): StatsStore | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const store = value as Partial<StatsStore>;
  const users = store.users && typeof store.users === 'object' ? store.users : {};
  const appliedRooms =
    store.appliedRooms && typeof store.appliedRooms === 'object' ? store.appliedRooms : {};

  return {
    updatedAt: typeof store.updatedAt === 'string' ? store.updatedAt : new Date().toISOString(),
    users: users as StatsStore['users'],
    appliedRooms: appliedRooms as StatsStore['appliedRooms']
  };
}

export async function readStatsStore(): Promise<StatsStore> {
  try {
    const raw = await readFile(dataPath(STORE_FILE), 'utf8');
    const parsed = normalizeStore(parseJsonFile(raw, STORE_FILE));
    return parsed ?? createEmptyStore();
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === 'ENOENT') {
      return createEmptyStore();
    }

    throw error;
  }
}

async function writeStatsStore(store: StatsStore): Promise<void> {
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

/** Applies a change under the write lock. The updater returns null to leave the file untouched. */
export async function updateStatsStore(
  updater: (store: StatsStore) => StatsStore | null
): Promise<StatsStore | null> {
  return withWriteLock(async () => {
    const store = await readStatsStore();
    const nextStore = updater(store);

    if (!nextStore) {
      return null;
    }

    await writeStatsStore(nextStore);
    return nextStore;
  });
}
