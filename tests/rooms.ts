import { createParticipant, createRoomRecord } from "@/server/rooms/store";
import type { RoomStatus, StoredRoom } from "@/server/rooms/types";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

type RoomSpec = {
  status: RoomStatus;
  /** How long ago the room was created, the last change happened, the host was last seen (milliseconds). */
  createdAgo: number;
  updatedAgo: number;
  hostSeenAgo: number;
  /** Set for a room with a second player. */
  guestSeenAgo?: number;
  /** Set for a finished room. */
  finishedAgo?: number;
};

const person = (id: number, nickname: string) => ({
  telegramId: id,
  telegramName: nickname,
  telegramUsername: null,
  telegramPhotoUrl: null,
  nickname
});

/** A stored room with the given ages, relative to `now`. */
export function roomFixture(now: number, spec: RoomSpec): StoredRoom {
  const at = (ago: number) => new Date(now - ago).toISOString();
  const room = createRoomRecord(createParticipant(person(-1, "Host"), at(spec.createdAgo)));

  return {
    ...room,
    createdAt: at(spec.createdAgo),
    updatedAt: at(spec.updatedAgo),
    status: spec.status,
    host: { ...room.host, lastSeenAt: at(spec.hostSeenAgo) },
    guest:
      spec.guestSeenAgo === undefined
        ? null
        : { ...createParticipant(person(-2, "Guest"), at(spec.createdAgo)), lastSeenAt: at(spec.guestSeenAgo) },
    finishedAt: spec.finishedAgo === undefined ? null : at(spec.finishedAgo)
  };
}
