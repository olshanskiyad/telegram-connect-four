// WebSocket server: pushes room updates to the browsers watching a room.
//
// It does not change any game state. The web app writes rooms to DATA_DIR/rooms.json; this process
// watches that file and sends each subscriber the current view of the room it is looking at.
// Browsers connect to ws://host:WS_PORT/?roomId=<code> (or /ws behind a reverse proxy).
//
// The server does not know who is asking: it takes nothing about the player from the URL and the
// view always has viewer: null. A browser learns its own role from the HTTP API and works out its
// color from hostColor and guestColor. Players are shown by nickname only: Telegram ids, names,
// usernames and photos are never sent.

import { readFile } from "fs/promises";
import { mkdirSync, watch } from "fs";
import path from "path";
import { WebSocketServer } from "ws";

// Read the same .env file as the web app. Variables that are already set in the environment win.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file (or an older Node): use the environment as it is
}

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const ROOMS_FILE = "rooms.json";
const PORT = Number(process.env.WS_PORT || 3002);
const HOST = process.env.WS_HOST || "127.0.0.1";

const SAFETY_TICK_MS = 3000; // re-check even if the file watcher missed an event
const PING_INTERVAL_MS = 30000;

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 1024 });
const subscriptions = new Map(); // socket -> { roomId, lastSent }
let refreshTimer = null;

async function readRooms() {
  try {
    const raw = await readFile(path.join(DATA_DIR, ROOMS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.rooms) ? parsed.rooms : [];
  } catch {
    return [];
  }
}

function findRoom(rooms, identifier) {
  const code = String(identifier).toUpperCase();
  return rooms.find((room) => room.id === identifier || room.inviteCode === identifier || room.inviteCode === code) ?? null;
}

function assignedColor(room, telegramId) {
  return room.colorAssignments?.[String(telegramId)] ?? null;
}

function publicParticipant(participant) {
  return {
    nickname: participant.nickname,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt
  };
}

function toRoomView(room) {
  const hostColor = assignedColor(room, room.host?.telegramId);
  const guestColor = room.guest ? assignedColor(room, room.guest.telegramId) : null;

  return {
    id: room.id,
    inviteCode: room.inviteCode,
    currentMatchId: room.currentMatchId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt ?? null,
    finishedAt: room.finishedAt ?? null,
    status: room.status,
    host: publicParticipant(room.host),
    guest: room.guest ? publicParticipant(room.guest) : null,
    hostColor,
    guestColor,
    turnColor: room.turnColor ?? null,
    score: room.score,
    board: room.board,
    result: room.result ?? null,
    spectatorCount: (room.spectators ?? []).length,
    playerCount: 1 + (room.guest ? 1 : 0),
    readyToStart: Boolean(hostColor && guestColor && hostColor !== guestColor && (room.moves ?? []).length === 0),
    viewer: null
  };
}

function sendSnapshot(socket, meta, rooms) {
  if (socket.readyState !== 1) {
    subscriptions.delete(socket);
    return;
  }

  const room = meta.roomId ? findRoom(rooms, meta.roomId) : null;
  let view = null;

  try {
    view = room ? toRoomView(room) : null;
  } catch {
    // A room that cannot be shown is treated as missing, so one bad record does not stop the others.
  }

  const message = JSON.stringify({ type: "room", room: view });

  if (message !== meta.lastSent) {
    meta.lastSent = message;
    socket.send(message);
  }
}

async function broadcastSnapshot() {
  const rooms = await readRooms();

  for (const [socket, meta] of subscriptions.entries()) {
    sendSnapshot(socket, meta, rooms);
  }
}

function scheduleBroadcast() {
  if (refreshTimer) {
    return;
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    broadcastSnapshot().catch(() => undefined);
  }, 100);
}

wss.on("connection", (socket, request) => {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("error", () => socket.terminate());
  socket.on("close", () => subscriptions.delete(socket));

  let url;

  try {
    url = new URL(request.url ?? "/", "http://localhost");
  } catch {
    socket.close(1008, "Bad request");
    return;
  }

  const meta = { roomId: url.searchParams.get("roomId"), lastSent: "" };

  subscriptions.set(socket, meta);
  socket.send(JSON.stringify({ type: "connected" }));
  readRooms()
    .then((rooms) => sendSnapshot(socket, meta, rooms))
    .catch(() => undefined);
});

try {
  mkdirSync(DATA_DIR, { recursive: true });
  watch(DATA_DIR, (_event, fileName) => {
    if (!fileName || fileName === ROOMS_FILE) {
      scheduleBroadcast();
    }
  });
} catch {
  console.warn(`Cannot watch ${DATA_DIR}; relying on the periodic check.`);
}

setInterval(scheduleBroadcast, SAFETY_TICK_MS);

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, PING_INTERVAL_MS);

function shutdown() {
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

wss.on("listening", () => {
  console.log(`WebSocket server listening on ${HOST}:${PORT}, watching ${DATA_DIR}`);
});

wss.on("error", (error) => {
  console.error(`WebSocket server error: ${error.message}`);
  process.exit(1);
});
