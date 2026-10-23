import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { upsertTelegramProfile, type StoredProfile } from "@/server/profile/store";
import { createRoom, joinRoom } from "@/server/rooms/service";
import { findStoredRoom, listStoredRooms, removeExpiredRooms, shouldKeepRoom } from "@/server/rooms/store";

import { HOUR, MINUTE, roomFixture } from "./rooms";

const NOW = Date.now();

describe("how long a room is kept", () => {
  it("keeps a room without a second player for 12 hours after creation, or while the host is around", () => {
    const room = (createdAgo: number, hostSeenAgo: number) =>
      roomFixture(NOW, { status: "lobby", createdAgo, updatedAgo: createdAgo, hostSeenAgo });

    assert.equal(shouldKeepRoom(room(11 * HOUR, 11 * HOUR), NOW), true);
    assert.equal(shouldKeepRoom(room(13 * HOUR, 13 * HOUR), NOW), false);
    assert.equal(shouldKeepRoom(room(13 * HOUR, 10 * MINUTE), NOW), true, "host seen 10 minutes ago");
    assert.equal(shouldKeepRoom(room(13 * HOUR, 50 * MINUTE), NOW), false, "host last seen 50 minutes ago");
  });

  it("treats a lobby with two players like an active room: 12 hours without changes, unless someone is around", () => {
    for (const status of ["lobby", "active"] as const) {
      const room = (updatedAgo: number, hostSeenAgo: number, guestSeenAgo: number) =>
        roomFixture(NOW, { status, createdAgo: 20 * HOUR, updatedAgo, hostSeenAgo, guestSeenAgo });

      assert.equal(shouldKeepRoom(room(11 * HOUR, 11 * HOUR, 11 * HOUR), NOW), true, `${status}: changed 11 hours ago`);
      assert.equal(shouldKeepRoom(room(13 * HOUR, 13 * HOUR, 13 * HOUR), NOW), false, `${status}: idle for 13 hours`);
      assert.equal(shouldKeepRoom(room(13 * HOUR, 10 * MINUTE, 13 * HOUR), NOW), true, `${status}: host seen 10 minutes ago`);
      assert.equal(shouldKeepRoom(room(13 * HOUR, 13 * HOUR, 10 * MINUTE), NOW), true, `${status}: guest seen 10 minutes ago`);
      assert.equal(shouldKeepRoom(room(13 * HOUR, 50 * MINUTE, 50 * MINUTE), NOW), false, `${status}: both gone for 50 minutes`);
    }
  });

  it("keeps a room with two players while a spectator is around", () => {
    const base = roomFixture(NOW, {
      status: "active",
      createdAgo: 20 * HOUR,
      updatedAgo: 13 * HOUR,
      hostSeenAgo: 13 * HOUR,
      guestSeenAgo: 13 * HOUR
    });
    const withSpectator = (seenAgo: number) => ({
      ...base,
      spectators: [{ ...base.host, lastSeenAt: new Date(NOW - seenAgo).toISOString() }]
    });

    assert.equal(shouldKeepRoom(withSpectator(10 * MINUTE), NOW), true);
    assert.equal(shouldKeepRoom(withSpectator(2 * HOUR), NOW), false);
  });

  it("keeps a finished room for 24 hours after the end", () => {
    const finished = (finishedAgo?: number) =>
      roomFixture(NOW, {
        status: "finished",
        createdAgo: 30 * HOUR,
        updatedAgo: 1 * MINUTE,
        hostSeenAgo: 1 * MINUTE,
        guestSeenAgo: 1 * MINUTE,
        finishedAgo
      });

    assert.equal(shouldKeepRoom(finished(23 * HOUR), NOW), true);
    assert.equal(shouldKeepRoom(finished(25 * HOUR), NOW), false);
    assert.equal(shouldKeepRoom(finished(undefined), NOW), false, "no end time");
  });
});

describe("expired rooms leave rooms.json", () => {
  let dataDir = "";
  let host: StoredProfile;
  let guest: StoredProfile;

  const roomsFile = () => path.join(dataDir, "rooms.json");
  const readRaw = () => readFileSync(roomsFile(), "utf8");
  const storedRooms = () => (JSON.parse(readRaw()) as { rooms: Array<Record<string, any>> }).rooms;

  /** Moves every timestamp of one room into the past, as if nobody had touched it for `hours`. */
  function ageRoom(code: string, hours: number): void {
    const past = new Date(Date.now() - hours * HOUR).toISOString();
    const store = JSON.parse(readRaw()) as { rooms: Array<Record<string, any>> };

    for (const room of store.rooms) {
      if (room.inviteCode !== code) continue;
      room.createdAt = past;
      room.updatedAt = past;
      room.host.lastSeenAt = past;
      if (room.guest) room.guest.lastSeenAt = past;
    }

    writeFileSync(roomsFile(), JSON.stringify(store, null, 2));
  }

  async function lobbyWithGuest(): Promise<string> {
    const created = await createRoom(host);
    await joinRoom(created.inviteCode, guest);
    return created.inviteCode;
  }

  before(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
    process.env.DATA_DIR = dataDir;

    host = await upsertTelegramProfile({ id: 5001, first_name: "Retention", last_name: "Host", username: "retention_host" });
    guest = await upsertTelegramProfile({ id: 5002, first_name: "Retention", last_name: "Guest", username: "retention_guest" });
  });

  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("removes a lobby with a second player after 12 hours, with the names and usernames inside", async () => {
    const code = await lobbyWithGuest();
    assert.ok(readRaw().includes("retention_host") && readRaw().includes("retention_guest"));

    ageRoom(code, 13);

    assert.equal(await findStoredRoom(code), null);
    assert.equal(storedRooms().length, 0, "the file itself is cleaned, not only the answer");
    assert.ok(!readRaw().includes("retention_host") && !readRaw().includes("retention_guest"));
  });

  it("keeps a lobby with a second player that changed within 12 hours", async () => {
    const code = await lobbyWithGuest();
    ageRoom(code, 11);

    assert.ok(await findStoredRoom(code));
    assert.equal(storedRooms().length, 1);
    ageRoom(code, 13);
    await removeExpiredRooms();
  });

  it("removes only the expired rooms from a list", async () => {
    const fresh = (await createRoom(host)).inviteCode;
    const stale = await lobbyWithGuest();
    ageRoom(stale, 13);

    const listed = await listStoredRooms();

    assert.deepEqual(listed.map((room) => room.inviteCode), [fresh]);
    assert.deepEqual(storedRooms().map((room) => room.inviteCode), [fresh]);
    ageRoom(fresh, 13);
    await removeExpiredRooms();
  });

  it("cleans the file on request even when nobody reads a room", async () => {
    const code = await lobbyWithGuest();
    ageRoom(code, 13);
    assert.equal(storedRooms().length, 1);

    await removeExpiredRooms();

    assert.equal(storedRooms().length, 0);
  });

  it("does not rewrite the file when nothing has expired", async () => {
    await lobbyWithGuest();
    const before = statSync(roomsFile());

    await listStoredRooms();
    await removeExpiredRooms();
    const after = statSync(roomsFile());

    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  it("ignores a stored room in an unknown or older format", async () => {
    const code = await lobbyWithGuest();
    const store = JSON.parse(readRaw()) as { rooms: Array<Record<string, any>> };
    delete store.rooms.find((room) => room.inviteCode === code)!.currentMatchId;
    writeFileSync(roomsFile(), JSON.stringify(store));

    assert.equal(await findStoredRoom(code), null);
  });
});
