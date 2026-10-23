import { randomUUID } from "crypto";

import {
  createBoard,
  dropDisc,
  findWinner,
  nextColor,
  type PlayerColor
} from "@/lib/connect-four";
import type { StoredProfile } from "@/server/profile/store";
import { recordRoomResult } from "@/server/stats/service";

import {
  assignRoomColorChoice,
  assignGuestOppositeColor,
  getRoomAssignedColor,
  getRoomGuestColor,
  getRoomHostColor,
  hasDistinctRoomColors
} from "./colors";
import {
  createParticipant,
  createRoomRecord,
  createPairedRoomRecord,
  findStoredRoom,
  insertStoredRoom,
  refreshParticipant,
  updateStoredRoom
} from "./store";
import type {
  PublicParticipant,
  RoomParticipant,
  RoomProfileInput,
  RoomRole,
  RoomView,
  StoredRoom
} from "./types";

export class RoomServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RoomServiceError";
    this.statusCode = statusCode;
  }
}

function badRequest(message: string): RoomServiceError {
  return new RoomServiceError(message, 400);
}

function notFound(message: string): RoomServiceError {
  return new RoomServiceError(message, 404);
}

function conflict(message: string): RoomServiceError {
  return new RoomServiceError(message, 409);
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRoomProfile(profile: StoredProfile): RoomProfileInput {
  return {
    telegramId: profile.telegramId,
    telegramName: profile.telegramName,
    telegramUsername: profile.telegramUsername,
    telegramPhotoUrl: profile.telegramPhotoUrl,
    nickname: profile.nickname
  };
}

function participantRole(room: StoredRoom, telegramId: number): RoomRole | null {
  if (room.host.telegramId === telegramId) {
    return "host";
  }

  if (room.guest?.telegramId === telegramId) {
    return "guest";
  }

  if (room.spectators.some((spectator) => spectator.telegramId === telegramId)) {
    return "spectator";
  }

  return null;
}

function participantColor(room: StoredRoom, telegramId: number): PlayerColor | null {
  return getRoomAssignedColor(room, telegramId);
}

function refreshParticipantInRoom(
  room: StoredRoom,
  profile: RoomProfileInput,
  role: RoomRole | null,
  now: string
): StoredRoom {
  if (role === "host") {
    return {
      ...room,
      host: refreshParticipant(room.host, profile, now),
      updatedAt: now
    };
  }

  if (role === "guest" && room.guest) {
    return {
      ...room,
      guest: refreshParticipant(room.guest, profile, now),
      updatedAt: now
    };
  }

  const spectatorIndex = room.spectators.findIndex(
    (spectator) => spectator.telegramId === profile.telegramId
  );

  if (spectatorIndex >= 0) {
    const spectators = [...room.spectators];
    spectators[spectatorIndex] = refreshParticipant(spectators[spectatorIndex], profile, now);

    return {
      ...room,
      spectators,
      updatedAt: now
    };
  }

  return room;
}

async function heartbeatRoom(identifier: string, profile: StoredProfile): Promise<RoomView | null> {
  const roomId = identifier.trim();
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = participantRole(room, profile.telegramId);

    if (role === "host" || role === "guest") {
      return refreshParticipantInRoom(room, input, role, now);
    }

    if (role === "spectator") {
      return refreshParticipantInRoom(room, input, role, now);
    }

    return room;
  });

  return nextRoom ? createRoomView(nextRoom, profile.telegramId) : null;
}

function removeSpectator(room: StoredRoom, telegramId: number): StoredRoom {
  const spectators = room.spectators.filter((spectator) => spectator.telegramId !== telegramId);

  if (spectators.length === room.spectators.length) {
    return room;
  }

  return {
    ...room,
    spectators
  };
}

function upsertSpectator(room: StoredRoom, profile: RoomProfileInput, now: string): StoredRoom {
  const existingIndex = room.spectators.findIndex(
    (spectator) => spectator.telegramId === profile.telegramId
  );

  if (existingIndex >= 0) {
    const spectators = [...room.spectators];
    spectators[existingIndex] = refreshParticipant(spectators[existingIndex], profile, now);

    return {
      ...room,
      spectators,
      updatedAt: now
    };
  }

  return {
    ...room,
    spectators: [...room.spectators, createParticipant(profile, now)],
    updatedAt: now
  };
}

function toPublicParticipant(participant: RoomParticipant): PublicParticipant {
  return {
    nickname: participant.nickname,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt
  };
}

function createRoomView(room: StoredRoom, viewerTelegramId: number | null = null): RoomView {
  const role = viewerTelegramId === null ? null : participantRole(room, viewerTelegramId);
  const color = viewerTelegramId === null ? null : participantColor(room, viewerTelegramId);
  const hostColor = getRoomHostColor(room);
  const guestColor = getRoomGuestColor(room);
  const viewer =
    viewerTelegramId === null || !role
      ? null
      : {
          telegramId: viewerTelegramId,
          role,
          color
        };

  return {
    id: room.id,
    inviteCode: room.inviteCode,
    currentMatchId: room.currentMatchId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    status: room.status,
    host: toPublicParticipant(room.host),
    guest: room.guest ? toPublicParticipant(room.guest) : null,
    hostColor,
    guestColor,
    turnColor: room.turnColor,
    score: room.score,
    board: room.board,
    result: room.result,
    spectatorCount: room.spectators.length,
    playerCount: 1 + (room.guest ? 1 : 0),
    readyToStart: hostColor !== null && guestColor !== null && room.moves.length === 0,
    viewer
  };
}

function ensureRoom(room: StoredRoom | null, identifier: string): StoredRoom {
  if (!room) {
    throw notFound(`Room not found: ${identifier}`);
  }

  return room;
}

function ensurePlayer(room: StoredRoom, telegramId: number): RoomRole {
  const role = participantRole(room, telegramId);

  if (role !== "host" && role !== "guest") {
    throw conflict("Only room players can make moves.");
  }

  return role;
}

function ensurePlayableSetup(room: StoredRoom): void {
  if (!room.guest) {
    throw conflict("A second player must join before the game can start.");
  }

  if (!hasDistinctRoomColors(room)) {
    throw conflict("Both players must choose opposite colors before the first move.");
  }
}

function ensureColor(color: string): PlayerColor {
  if (color !== "red" && color !== "green") {
    throw badRequest("Color must be red or green.");
  }

  return color;
}

function ensureColumn(column: number): number {
  if (!Number.isInteger(column) || column < 0 || column > 6) {
    throw badRequest("Column must be an integer between 0 and 6.");
  }

  return column;
}

function startIfReady(room: StoredRoom, now: string): StoredRoom {
  if (room.status !== "lobby") {
    return room;
  }

  if (room.moves.length > 0 || !room.guest || !hasDistinctRoomColors(room)) {
    return room;
  }

  return {
    ...room,
    status: "active",
    startedAt: room.startedAt ?? now,
    turnColor: "red",
    updatedAt: now
  };
}

function finishRoom(room: StoredRoom, now: string): StoredRoom {
  let score = room.score;

  if (room.result?.kind === "win" && room.guest) {
    const hostColor = getRoomHostColor(room);
    const winnerIsHost = hostColor === room.result.winner;
    score = {
      host: room.score.host + (winnerIsHost ? 1 : 0),
      guest: room.score.guest + (winnerIsHost ? 0 : 1)
    };
  }

  return {
    ...room,
    status: "finished",
    finishedAt: room.finishedAt ?? now,
    turnColor: null,
    score,
    updatedAt: now
  };
}

async function recordTerminalRoomResult(room: StoredRoom): Promise<void> {
  if (room.status !== "finished" || !room.result) {
    return;
  }

  await recordRoomResult(room);
}

export async function createRoom(profile: StoredProfile): Promise<RoomView> {
  const now = nowIso();
  const host = createParticipant(toRoomProfile(profile), now);
  const room = await insertStoredRoom(createRoomRecord(host));

  return createRoomView(room, profile.telegramId);
}

export async function createRandomMatchRoom(
  hostProfile: StoredProfile,
  guestProfile: StoredProfile,
  viewerTelegramId: number
): Promise<RoomView> {
  const now = nowIso();
  const host = createParticipant(toRoomProfile(hostProfile), now);
  const guest = createParticipant(toRoomProfile(guestProfile), now);
  const hostColor: PlayerColor = "red";
  const turnColor: PlayerColor = "red";

  const room = await insertStoredRoom(
    createPairedRoomRecord(host, guest, hostColor, turnColor)
  );

  return createRoomView(room, viewerTelegramId);
}

export async function getRoom(identifier: string): Promise<RoomView | null> {
  const room = await findStoredRoom(identifier.trim());
  return room ? createRoomView(room) : null;
}

export async function getRoomForViewer(
  identifier: string,
  viewerTelegramId: number
): Promise<RoomView | null> {
  const room = await findStoredRoom(identifier.trim());
  return room ? createRoomView(room, viewerTelegramId) : null;
}

export async function heartbeatRoomView(
  identifier: string,
  profile: StoredProfile
): Promise<RoomView | null> {
  return heartbeatRoom(identifier, profile);
}

export async function joinRoom(identifier: string, profile: StoredProfile): Promise<RoomView> {
  const roomId = identifier.trim();
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = participantRole(room, profile.telegramId);

    if (role === "host" || role === "guest") {
      return startIfReady(refreshParticipantInRoom(room, input, role, now), now);
    }

    let next = room;

    if (room.status !== "finished" && room.guest === null) {
      next = {
        ...room,
        guest: createParticipant(input, now),
        updatedAt: now
      };
      next = assignGuestOppositeColor(next, profile.telegramId);
      next = removeSpectator(next, profile.telegramId);
      return startIfReady(next, now);
    }

    next = upsertSpectator(room, input, now);
    return next;
  });

  return createRoomView(ensureRoom(nextRoom, roomId), profile.telegramId);
}

export async function reconnectRoom(
  identifier: string,
  profile: StoredProfile
): Promise<RoomView> {
  const roomId = identifier.trim();
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = participantRole(room, profile.telegramId);

    if (role === "host" || role === "guest") {
      return startIfReady(refreshParticipantInRoom(room, input, role, now), now);
    }

    return upsertSpectator(room, input, now);
  });

  return createRoomView(ensureRoom(nextRoom, roomId), profile.telegramId);
}

export async function updateRoomColor(
  identifier: string,
  profile: StoredProfile,
  color: string
): Promise<RoomView> {
  const roomId = identifier.trim();
  const desiredColor =
    color === "random" ? (Math.random() < 0.5 ? "red" : "green") : ensureColor(color);
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = ensurePlayer(room, profile.telegramId);

    if (room.status === "finished") {
      throw conflict("Finished rooms cannot be reconfigured.");
    }

    if (room.moves.length > 0) {
      throw conflict("Colors can only be updated before the first move.");
    }

    if (hasDistinctRoomColors(room)) {
      throw conflict("Colors are already chosen.");
    }

    const nextRoomWithColors = assignRoomColorChoice(room, profile.telegramId, desiredColor);
    const shouldStart = Boolean(nextRoomWithColors.guest && hasDistinctRoomColors(nextRoomWithColors));

    return {
      ...nextRoomWithColors,
      host: role === "host" ? refreshParticipant(room.host, input, now) : room.host,
      guest: role === "guest" && room.guest ? refreshParticipant(room.guest, input, now) : room.guest,
      status: shouldStart ? "active" : "lobby",
      startedAt: shouldStart ? room.startedAt ?? now : room.startedAt,
      turnColor: shouldStart ? "red" : null,
      updatedAt: now
    };
  });

  return createRoomView(ensureRoom(nextRoom, roomId), profile.telegramId);
}

export async function restartRoom(
  identifier: string,
  profile: StoredProfile
): Promise<RoomView> {
  const roomId = identifier.trim();
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = ensurePlayer(room, profile.telegramId);

    if (room.status !== "finished") {
      throw conflict("A new round can only start after the game is finished.");
    }

    return {
      ...room,
      currentMatchId: randomUUID(),
      status: "lobby",
      startedAt: null,
      finishedAt: null,
      host: role === "host" ? refreshParticipant(room.host, input, now) : room.host,
      guest: role === "guest" && room.guest ? refreshParticipant(room.guest, input, now) : room.guest,
      hostColor: null,
      turnColor: null,
      colorAssignments: {},
      board: createBoard(),
      result: null,
      moves: [],
      score: room.score,
      updatedAt: now
    };
  });

  return createRoomView(ensureRoom(nextRoom, roomId), profile.telegramId);
}

export async function makeMove(
  identifier: string,
  profile: StoredProfile,
  column: number
): Promise<RoomView> {
  const roomId = identifier.trim();
  const moveColumn = ensureColumn(column);
  const now = nowIso();
  const input = toRoomProfile(profile);

  const nextRoom = await updateStoredRoom(roomId, (room) => {
    const role = ensurePlayer(room, profile.telegramId);
    const playerColor = participantColor(room, profile.telegramId);

    if (room.status === "finished") {
      throw conflict("Finished rooms do not accept moves.");
    }

    ensurePlayableSetup(room);

    if (playerColor === null) {
      throw conflict("Player colors are not assigned yet.");
    }

    let next = room;

    if (room.status === "lobby") {
      next = startIfReady(room, now);
    }

    const activeRoom = next.turnColor === null ? { ...next, turnColor: "red" as PlayerColor } : next;

    if (activeRoom.turnColor !== playerColor) {
      throw conflict("It is not this player's turn.");
    }

    const drop = dropDisc(activeRoom.board, moveColumn, playerColor);

    if (!drop) {
      throw conflict("That column is full.");
    }

    const boardResult = findWinner(drop.board);
    const moves = [
      ...activeRoom.moves,
      {
        index: activeRoom.moves.length,
        telegramId: profile.telegramId,
        color: playerColor,
        column: moveColumn,
        row: drop.row,
        createdAt: now
      }
    ];

    const nextHost =
      role === "host" ? refreshParticipant(activeRoom.host, input, now) : activeRoom.host;
    const nextGuest =
      role === "guest" && activeRoom.guest
        ? refreshParticipant(activeRoom.guest, input, now)
        : activeRoom.guest;

    if (boardResult.kind === "win") {
      return finishRoom(
        {
          ...activeRoom,
          startedAt: activeRoom.startedAt ?? now,
          host: nextHost,
          guest: nextGuest,
          board: drop.board,
          moves,
          result: {
            kind: "win",
            winner: boardResult.winner,
            line: boardResult.line
          },
          updatedAt: now
        },
        now
      );
    }

    if (boardResult.kind === "draw") {
      return finishRoom(
        {
          ...activeRoom,
          startedAt: activeRoom.startedAt ?? now,
          host: nextHost,
          guest: nextGuest,
          board: drop.board,
          moves,
          result: {
            kind: "draw"
          },
          updatedAt: now
        },
        now
      );
    }

    return {
      ...activeRoom,
      status: "active",
      startedAt: activeRoom.startedAt ?? now,
      host: nextHost,
      guest: nextGuest,
      board: drop.board,
      moves,
      turnColor: nextColor(playerColor),
      result: null,
      updatedAt: now
    };
  });

  const finalizedRoom = ensureRoom(nextRoom, roomId);
  await recordTerminalRoomResult(finalizedRoom);
  return createRoomView(finalizedRoom, profile.telegramId);
}

export function roomToView(room: StoredRoom, viewerTelegramId: number | null = null): RoomView {
  return createRoomView(room, viewerTelegramId);
}
