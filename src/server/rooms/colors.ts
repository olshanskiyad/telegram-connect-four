import { nextColor, type PlayerColor } from "@/lib/connect-four";

import type { StoredRoom } from "./types";

export function getRoomAssignedColor(room: StoredRoom, telegramId: number): PlayerColor | null {
  return room.colorAssignments[String(telegramId)] ?? null;
}

function getRoomPlayerIds(room: StoredRoom): string[] {
  return [String(room.host.telegramId), room.guest ? String(room.guest.telegramId) : ""].filter(Boolean);
}

export function pruneRoomColorAssignments(room: StoredRoom): StoredRoom {
  const playerIds = new Set(getRoomPlayerIds(room));
  const colorAssignments = Object.fromEntries(
    Object.entries(room.colorAssignments).filter(([telegramId]) => playerIds.has(telegramId))
  );

  return {
    ...room,
    colorAssignments,
    hostColor: colorAssignments[String(room.host.telegramId)] ?? null
  };
}

export function getRoomHostColor(room: StoredRoom): PlayerColor | null {
  return getRoomAssignedColor(room, room.host.telegramId);
}

export function getRoomGuestColor(room: StoredRoom): PlayerColor | null {
  return room.guest ? getRoomAssignedColor(room, room.guest.telegramId) : null;
}

export function hasDistinctRoomColors(room: StoredRoom): boolean {
  const hostColor = getRoomHostColor(room);
  const guestColor = getRoomGuestColor(room);

  return hostColor !== null && guestColor !== null && hostColor !== guestColor;
}

export function assignRoomColorChoice(
  room: StoredRoom,
  chooserTelegramId: number,
  chosenColor: PlayerColor
): StoredRoom {
  const colorAssignments = { ...room.colorAssignments };
  const otherColor = nextColor(chosenColor);
  const chooserId = String(chooserTelegramId);
  const hostId = String(room.host.telegramId);
  const guestId = room.guest ? String(room.guest.telegramId) : null;

  colorAssignments[chooserId] = chosenColor;

  if (guestId) {
    const otherPlayerId = chooserId === hostId ? guestId : hostId;
    colorAssignments[otherPlayerId] = otherColor;
  }

  return pruneRoomColorAssignments({
    ...room,
    colorAssignments,
    hostColor: colorAssignments[hostId] ?? null
  });
}

export function assignGuestOppositeColor(room: StoredRoom, guestTelegramId: number): StoredRoom {
  const hostColor = getRoomHostColor(room);

  if (!hostColor) {
    return pruneRoomColorAssignments(room);
  }

  const colorAssignments = {
    ...room.colorAssignments,
    [String(room.host.telegramId)]: hostColor,
    [String(guestTelegramId)]: nextColor(hostColor)
  };

  return pruneRoomColorAssignments({
    ...room,
    colorAssignments,
    hostColor
  });
}
