import crypto from "crypto";
import { readFile } from "fs/promises";

import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  createBoard,
  type Board,
  type PlayerColor
} from "@/lib/connect-four";

import { dataPath } from "../data-dir";
import { parseJsonFile, writeJsonFile } from "../json-file";

import type {
  RoomParticipant,
  RoomProfileInput,
  RoomMove,
  RoomStoredResult,
  StoredRoom
} from "./types";

type RoomStoreRecord = {
  rooms: StoredRoom[];
};

type NonNullableRoomStoredResult = Exclude<RoomStoredResult, null>;

const STORE_FILE = "rooms.json";

// How long a room stays in rooms.json (the README lists the same periods). A room is kept while:
// - it has no second player: the host was seen in the last 45 minutes, or the room is younger than 12 hours;
// - it has two players, started or not: anyone was seen in the last 45 minutes, or the room changed in the last 12 hours;
// - it is finished: it ended less than 24 hours ago.
// Expired rooms are removed the next time the file is read or written.
const ROOM_LOBBY_TTL_MS = 12 * 60 * 60 * 1000;
const ROOM_ACTIVE_TTL_MS = 12 * 60 * 60 * 1000;
const ROOM_FINISHED_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_SEEN_TTL_MS = 45 * 60 * 1000;
let writeQueue: Promise<void> = Promise.resolve();

function isPlayerColor(value: unknown): value is PlayerColor {
  return value === "red" || value === "green";
}

function isBoardCell(value: unknown): boolean {
  return value === null || isPlayerColor(value);
}

function isBoard(value: unknown): value is Board {
  if (!Array.isArray(value) || value.length !== BOARD_ROWS) {
    return false;
  }

  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === BOARD_COLUMNS &&
      row.every((cell) => isBoardCell(cell))
  );
}

function isParticipant(value: unknown): value is RoomParticipant {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const participant = value as Partial<RoomParticipant>;

  return (
    typeof participant.telegramId === "number" &&
    typeof participant.telegramName === "string" &&
    typeof participant.nickname === "string" &&
    typeof participant.joinedAt === "string" &&
    typeof participant.lastSeenAt === "string" &&
    (typeof participant.telegramUsername === "string" || participant.telegramUsername === null) &&
    (typeof participant.telegramPhotoUrl === "string" || participant.telegramPhotoUrl === null)
  );
}

function isRoomMove(value: unknown): value is RoomMove {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const move = value as Partial<RoomMove>;

  return (
    typeof move.index === "number" &&
    typeof move.telegramId === "number" &&
    isPlayerColor(move.color) &&
    Number.isInteger(move.column) &&
    Number.isInteger(move.row) &&
    typeof move.createdAt === "string"
  );
}

function isColorAssignment(value: unknown): value is PlayerColor {
  return value === "red" || value === "green";
}

function isColorAssignments(value: unknown): value is Record<string, PlayerColor> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.entries(value).every(
    ([key, color]) => typeof key === "string" && isColorAssignment(color)
  );
}

function isRoomStatus(value: unknown): value is StoredRoom["status"] {
  return value === "lobby" || value === "active" || value === "finished";
}

function isStoredResult(value: unknown): value is RoomStoredResult {
  if (value === null) {
    return true;
  }

  if (typeof value !== "object") {
    return false;
  }

  const result = value as Partial<NonNullableRoomStoredResult>;

  if (result.kind === "draw") {
    return true;
  }

  if (result.kind === "win") {
    return (
      isPlayerColor(result.winner) &&
      Array.isArray(result.line) &&
      result.line.length > 0 &&
      result.line.every(
        (cell: { row?: number; col?: number }) =>
          typeof cell === "object" &&
          cell !== null &&
          Number.isInteger((cell as { row?: number }).row) &&
          Number.isInteger((cell as { col?: number }).col)
      )
    );
  }

  return false;
}

function isScore(value: unknown): value is StoredRoom["score"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const score = value as Partial<StoredRoom["score"]>;
  return typeof score.host === "number" && typeof score.guest === "number";
}

function isRecent(timestamp: string, windowMs: number, nowMs: number): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && nowMs - parsed <= windowMs;
}

export function shouldKeepRoom(room: StoredRoom, nowMs: number): boolean {
  if (room.status === "finished") {
    return Boolean(room.finishedAt) && isRecent(room.finishedAt as string, ROOM_FINISHED_TTL_MS, nowMs);
  }

  const hostSeen = isRecent(room.host.lastSeenAt, ROOM_SEEN_TTL_MS, nowMs);

  if (!room.guest) {
    return hostSeen || isRecent(room.createdAt, ROOM_LOBBY_TTL_MS, nowMs);
  }

  const guestSeen = isRecent(room.guest.lastSeenAt, ROOM_SEEN_TTL_MS, nowMs);
  const spectatorSeen = room.spectators.some((spectator) =>
    isRecent(spectator.lastSeenAt, ROOM_SEEN_TTL_MS, nowMs)
  );

  return hostSeen || guestSeen || spectatorSeen || isRecent(room.updatedAt, ROOM_ACTIVE_TTL_MS, nowMs);
}

function pruneExpiredRooms(rooms: StoredRoom[]): StoredRoom[] {
  const nowMs = Date.now();
  return rooms.filter((room) => shouldKeepRoom(room, nowMs));
}

function normalizeRoom(value: unknown): StoredRoom | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const room = value as Partial<StoredRoom>;

  if (
    typeof room.id !== "string" ||
    typeof room.inviteCode !== "string" ||
    typeof room.currentMatchId !== "string" ||
    typeof room.createdAt !== "string" ||
    typeof room.updatedAt !== "string" ||
    !isRoomStatus(room.status) ||
    !isParticipant(room.host) ||
    !isBoard(room.board) ||
    !Array.isArray(room.spectators) ||
    !room.spectators.every(isParticipant) ||
    !Array.isArray(room.moves) ||
    !room.moves.every(isRoomMove) ||
    !isStoredResult(room.result) ||
    !isColorAssignments(room.colorAssignments) ||
    !isScore(room.score)
  ) {
    return null;
  }

  if (
    (room.hostColor !== null && !isPlayerColor(room.hostColor)) ||
    (room.turnColor !== null && !isPlayerColor(room.turnColor))
  ) {
    return null;
  }

  if (room.guest !== null && !isParticipant(room.guest)) {
    return null;
  }

  if (
    (room.startedAt !== null && typeof room.startedAt !== "string") ||
    (room.finishedAt !== null && typeof room.finishedAt !== "string")
  ) {
    return null;
  }

  return room as StoredRoom;
}

/** Reads rooms.json from disk without writing. Rooms that are invalid or expired are left out; `expired` says whether any expired ones were. */
async function loadRooms(): Promise<{ rooms: StoredRoom[]; expired: boolean }> {
  try {
    const raw = await readFile(dataPath(STORE_FILE), "utf8");
    const parsed = parseJsonFile(raw, STORE_FILE) as Partial<RoomStoreRecord>;

    if (!parsed.rooms || !Array.isArray(parsed.rooms)) {
      return { rooms: [], expired: false };
    }

    const valid = parsed.rooms.map(normalizeRoom).filter((room): room is StoredRoom => room !== null);
    const rooms = pruneExpiredRooms(valid);

    return { rooms, expired: rooms.length !== valid.length };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return { rooms: [], expired: false };
    }

    throw error;
  }
}

async function writeStore(store: RoomStoreRecord): Promise<void> {
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

/** Deletes expired rooms from the file. Runs under the write lock, so it cannot overwrite a change made at the same time. */
export async function removeExpiredRooms(): Promise<void> {
  await withWriteLock(async () => {
    const { rooms, expired } = await loadRooms();

    if (expired) {
      await writeStore({ rooms });
    }
  });
}

/** For code that does not hold the write lock. Expired rooms are not returned, and are deleted from the file. */
async function readStore(): Promise<RoomStoreRecord> {
  const { rooms, expired } = await loadRooms();

  if (expired) {
    await removeExpiredRooms();
  }

  return { rooms };
}

export function createParticipant(profile: RoomProfileInput, now: string): RoomParticipant {
  return {
    telegramId: profile.telegramId,
    telegramName: profile.telegramName,
    telegramUsername: profile.telegramUsername,
    telegramPhotoUrl: profile.telegramPhotoUrl,
    nickname: profile.nickname,
    joinedAt: now,
    lastSeenAt: now
  };
}

export function refreshParticipant(
  participant: RoomParticipant,
  profile: RoomProfileInput,
  now: string
): RoomParticipant {
  return {
    ...participant,
    telegramName: profile.telegramName,
    telegramUsername: profile.telegramUsername,
    telegramPhotoUrl: profile.telegramPhotoUrl,
    nickname: profile.nickname,
    lastSeenAt: now
  };
}

export function createRoomRecord(host: RoomParticipant): StoredRoom {
  const now = host.joinedAt;

  return {
    id: crypto.randomUUID(),
    inviteCode: "",
    currentMatchId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    status: "lobby",
    host,
    guest: null,
    spectators: [],
    hostColor: null,
    turnColor: null,
    colorAssignments: {},
    score: {
      host: 0,
      guest: 0
    },
    board: createBoard(),
    result: null,
    moves: []
  };
}

export function createPairedRoomRecord(
  host: RoomParticipant,
  guest: RoomParticipant,
  hostColor: PlayerColor,
  turnColor: PlayerColor
): StoredRoom {
  const now = host.joinedAt;

  return {
    ...createRoomRecord(host),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    status: "active",
    guest,
    hostColor,
    turnColor,
    currentMatchId: crypto.randomUUID(),
    score: {
      host: 0,
      guest: 0
    },
    colorAssignments: {
      [String(host.telegramId)]: hostColor,
      [String(guest.telegramId)]: hostColor === "red" ? "green" : "red"
    }
  };
}

function isUniqueInviteCode(store: RoomStoreRecord, inviteCode: string): boolean {
  return !store.rooms.some((room) => room.inviteCode === inviteCode);
}

function generateInviteCode(store: RoomStoreRecord): string {
  let code = "";

  do {
    code = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (!code || !isUniqueInviteCode(store, code));

  return code;
}

function locateRoomIndex(store: RoomStoreRecord, identifier: string): number {
  return store.rooms.findIndex(
    (room) =>
      room.id === identifier ||
      room.inviteCode === identifier ||
      room.inviteCode === identifier.toUpperCase()
  );
}

export async function listStoredRooms(): Promise<StoredRoom[]> {
  const store = await readStore();
  return [...store.rooms].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findStoredRoom(identifier: string): Promise<StoredRoom | null> {
  const store = await readStore();
  return (
    store.rooms.find(
      (room) =>
        room.id === identifier ||
        room.inviteCode === identifier ||
        room.inviteCode === identifier.toUpperCase()
    ) ?? null
  );
}

export async function insertStoredRoom(room: StoredRoom): Promise<StoredRoom> {
  return withWriteLock(async () => {
    const store = { rooms: (await loadRooms()).rooms };
    const nextRoom: StoredRoom = {
      ...room,
      inviteCode: room.inviteCode || generateInviteCode(store)
    };

    store.rooms.push(nextRoom);
    await writeStore(store);

    return nextRoom;
  });
}

export async function updateStoredRoom(
  identifier: string,
  updater: (room: StoredRoom) => StoredRoom | null
): Promise<StoredRoom | null> {
  return withWriteLock(async () => {
    const store = { rooms: (await loadRooms()).rooms };
    const index = locateRoomIndex(store, identifier);

    if (index === -1) {
      return null;
    }

    const nextRoom = updater(store.rooms[index]);

    if (!nextRoom) {
      return null;
    }

    store.rooms[index] = nextRoom;
    await writeStore(store);

    return nextRoom;
  });
}
