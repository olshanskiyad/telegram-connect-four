import type { StoredProfile } from "@/server/profile/store";
import { createRandomMatchRoom, getRoom, getRoomForViewer } from "@/server/rooms/service";
import type { RoomView } from "@/server/rooms/types";

import { mutateMatchmakingStore, readMatchmakingStore } from "./store";
import type { MatchmakingEntry, MatchmakingView } from "./types";

export class MatchmakingServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "MatchmakingServiceError";
    this.statusCode = statusCode;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

const MATCH_LIVE_TTL_MS = 30 * 60 * 1000;

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// How long an entry stays in matchmaking.json (the README lists the same periods). Entries hold a copy of the player's profile.
const WAITING_ENTRY_TTL_MS = 30 * 60 * 1000;
const MATCHED_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

function pruneExpiredEntries(entries: MatchmakingEntry[], nowMs: number): MatchmakingEntry[] {
  return entries.filter((entry) => {
    if (entry.status === "waiting") {
      const joinedAt = Date.parse(entry.joinedAt);
      return Number.isFinite(joinedAt) && nowMs - joinedAt <= WAITING_ENTRY_TTL_MS;
    }

    if (entry.status === "matched") {
      const matchedAt = entry.matchedAt ? Date.parse(entry.matchedAt) : Number.NaN;
      return Number.isFinite(matchedAt) && nowMs - matchedAt <= MATCHED_ENTRY_TTL_MS;
    }

    return false;
  });
}

async function pruneEntriesWithExistingRooms(entries: MatchmakingEntry[]): Promise<MatchmakingEntry[]> {
  const cleaned: MatchmakingEntry[] = [];

  for (const entry of entries) {
    if (entry.status === "waiting") {
      if (entry.roomInviteCode) {
        const room = await getRoom(entry.roomInviteCode);
        if (!room) {
          continue;
        }
      }
    }

    cleaned.push(entry);
  }

  return cleaned;
}

async function cleanEntries(entries: MatchmakingEntry[]): Promise<MatchmakingEntry[]> {
  return pruneEntriesWithExistingRooms(pruneExpiredEntries(entries, Date.now()));
}

function getLatestEntry(entries: MatchmakingEntry[], telegramId: number): MatchmakingEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].telegramId === telegramId) {
      return entries[index];
    }
  }

  return null;
}

function getWaitingEntries(entries: MatchmakingEntry[]): MatchmakingEntry[] {
  return entries
    .filter((entry) => entry.status === "waiting")
    .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt));
}

function computeQueuePosition(entries: MatchmakingEntry[], telegramId: number): number | null {
  const waitingEntries = getWaitingEntries(entries);
  const index = waitingEntries.findIndex((entry) => entry.telegramId === telegramId);
  return index >= 0 ? index + 1 : null;
}

function buildView(
  room: RoomView | null,
  entry: MatchmakingEntry | null,
  entries: MatchmakingEntry[]
): MatchmakingView {
  return {
    status: entry?.status ?? (room ? "matched" : "idle"),
    queuePosition: entry?.status === "waiting" ? computeQueuePosition(entries, entry.telegramId) : null,
    waitingCount: getWaitingEntries(entries).length,
    joinedAt: entry?.joinedAt ?? null,
    matchedAt: entry?.matchedAt ?? null,
    room
  };
}

function createMatchedEntry(profile: StoredProfile, now: string, room: RoomView): MatchmakingEntry {
  return {
    id: makeId(),
    telegramId: profile.telegramId,
    profile: { ...profile },
    status: "matched",
    joinedAt: now,
    updatedAt: now,
    matchedAt: now,
    roomId: room.id,
    roomInviteCode: room.inviteCode
  };
}

async function resolveRoom(entry: MatchmakingEntry): Promise<RoomView | null> {
  if (!entry.roomInviteCode) {
    return null;
  }

  return getRoomForViewer(entry.roomInviteCode, entry.telegramId);
}

function isLiveMatchRoom(room: RoomView | null): room is RoomView {
  if (
    !room ||
    room.status !== "active" ||
    room.playerCount !== 2 ||
    !room.turnColor ||
    room.hostColor === null ||
    room.guestColor === null ||
    room.hostColor === room.guestColor
  ) {
    return false;
  }

  const nowMs = Date.now();
  const hostFresh = Number.isFinite(Date.parse(room.host.lastSeenAt))
    ? nowMs - Date.parse(room.host.lastSeenAt) <= MATCH_LIVE_TTL_MS
    : false;
  const guestFresh =
    room.guest && Number.isFinite(Date.parse(room.guest.lastSeenAt))
      ? nowMs - Date.parse(room.guest.lastSeenAt) <= MATCH_LIVE_TTL_MS
      : false;

  return hostFresh && guestFresh;
}

export async function getMatchmakingStatus(profile: StoredProfile): Promise<MatchmakingView> {
  const store = await readMatchmakingStore();
  let entries = await cleanEntries(store.entries);

  if (entries.length !== store.entries.length) {
    // Expired entries hold a copy of a profile: they must leave the file, not only this answer.
    entries = await mutateMatchmakingStore(async (current) => {
      current.entries = await cleanEntries(current.entries);
      return current.entries;
    });
  }

  const latest = getLatestEntry(entries, profile.telegramId);

  if (latest?.status === "waiting") {
    return buildView(null, latest, entries);
  }

  if (latest?.status === "matched") {
    const matchedRoom = latest.roomInviteCode ? await resolveRoom(latest) : null;

    if (!isLiveMatchRoom(matchedRoom)) {
      return mutateMatchmakingStore(async (nextStore) => {
        const current = await cleanEntries(nextStore.entries);
        nextStore.entries = current.filter((entry) => entry.id !== latest.id);
        return buildView(null, null, nextStore.entries);
      });
    }

    return buildView(matchedRoom, matchedRoom ? latest : null, entries);
  }

  if (!latest) {
    return buildView(null, null, entries);
  }

  return buildView(null, latest, entries);
}

export async function cancelMatchmakingQueue(profile: StoredProfile): Promise<MatchmakingView> {
  return mutateMatchmakingStore(async (store) => {
    const now = nowIso();
    let entries = await cleanEntries(store.entries);
    const latestIndex = [...entries]
      .reverse()
      .findIndex((entry) => entry.telegramId === profile.telegramId);

    if (latestIndex === -1) {
      store.entries = entries;
      return buildView(null, null, store.entries);
    }

    const realIndex = entries.length - 1 - latestIndex;
    const latest = entries[realIndex];

    if (latest.status !== "waiting") {
      store.entries = entries;
      const matchedRoom = latest.status === "matched" ? await resolveRoom(latest) : null;

      if (latest.status === "matched" && !isLiveMatchRoom(matchedRoom)) {
        store.entries = entries.filter((entry) => entry.id !== latest.id);
        return buildView(null, null, store.entries);
      }

      return buildView(matchedRoom, matchedRoom ? latest : null, store.entries);
    }

    entries[realIndex] = {
      ...latest,
      status: "idle",
      updatedAt: now
    };

    store.entries = entries.filter((entry) => entry.status !== "idle");
    return buildView(null, null, store.entries);
  });
}

export async function joinMatchmakingQueue(profile: StoredProfile): Promise<MatchmakingView> {
  return mutateMatchmakingStore(async (store) => {
    const now = nowIso();
    let entries = await cleanEntries(store.entries);
    const latest = getLatestEntry(entries, profile.telegramId);

    if (latest?.status === "waiting") {
      store.entries = entries;
      return buildView(null, latest, store.entries);
    }

    if (latest?.status === "matched") {
      const matchedRoom = latest.roomInviteCode ? await resolveRoom(latest) : null;

      if (isLiveMatchRoom(matchedRoom)) {
        store.entries = entries;
        return buildView(matchedRoom, latest, store.entries);
      }

      entries = entries.filter((entry) => entry.id !== latest.id);
    }

    const opponent = getWaitingEntries(entries).find((entry) => entry.telegramId !== profile.telegramId);

    if (!opponent) {
      const nextEntry: MatchmakingEntry = {
        id: makeId(),
        telegramId: profile.telegramId,
        profile: { ...profile },
        status: "waiting",
        joinedAt: now,
        updatedAt: now,
        matchedAt: null,
        roomId: null,
        roomInviteCode: null
      };
      entries.push(nextEntry);
      store.entries = entries;
      return buildView(null, nextEntry, store.entries);
    }

    const matchedRoom = await createRandomMatchRoom(opponent.profile, profile, profile.telegramId);

    const opponentIndex = entries.findIndex((entry) => entry.id === opponent.id);
    if (opponentIndex >= 0) {
      entries[opponentIndex] = {
        ...opponent,
        status: "matched",
        updatedAt: now,
        matchedAt: now,
        roomId: matchedRoom.id,
        roomInviteCode: matchedRoom.inviteCode
      };
    }

    const currentEntry = createMatchedEntry(profile, now, matchedRoom);
    entries.push(currentEntry);
    store.entries = entries;

    return buildView(matchedRoom, currentEntry, store.entries);
  });
}
