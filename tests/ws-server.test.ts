import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import WebSocket from "ws";

import { openGuestSession } from "@/server/profile/service";
import type { StoredProfile } from "@/server/profile/store";
import { createRoom, joinRoom, makeMove, roomToView, updateRoomColor } from "@/server/rooms/service";
import { findStoredRoom } from "@/server/rooms/store";

let dataDir = "";
let server: ChildProcess | null = null;
let port = 0;
let code = "";
let host: StoredProfile;
let guest: StoredProfile;
const sockets: WebSocket[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: found } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(found));
    });
  });
}

function waitUntilListening(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws-server did not start")), 10000);
    child.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve(String(chunk));
      }
    });
    child.once("exit", () => reject(new Error("ws-server exited early")));
  });
}

/** Starts ws-server.mjs on a free port. `host` is passed as WS_HOST ("" leaves the default). */
async function startServer(host: string): Promise<{ child: ChildProcess; port: number; banner: string }> {
  const freeServerPort = await freePort();
  const child = spawn(process.execPath, ["ws-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, WS_PORT: String(freeServerPort), WS_HOST: host, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const banner = await waitUntilListening(child);
  return { child, port: freeServerPort, banner };
}

type RoomMessage = { type: string; room?: Record<string, unknown> | null };

/** Opens a socket and collects what the server sends. */
function subscribe(query: string): { messages: RoomMessage[]; socket: WebSocket } {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${query}`);
  const messages: RoomMessage[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data)) as RoomMessage));
  sockets.push(socket);
  return { messages, socket };
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const value = read();

    if (value !== undefined) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("timed out waiting for a WebSocket message");
}

const roomMessages = (messages: RoomMessage[]) => messages.filter((message) => message.type === "room");

before(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.GUEST_MODE = "true";
  delete process.env.TELEGRAM_BOT_TOKEN;

  host = (await openGuestSession()).profile;
  guest = (await openGuestSession()).profile;

  const created = await createRoom(host);
  code = created.inviteCode;
  await joinRoom(code, guest);
  await updateRoomColor(code, host, "red");
  await makeMove(code, host, 3);

  const started = await startServer("127.0.0.1");
  server = started.child;
  port = started.port;
});

after(() => {
  for (const socket of sockets) {
    socket.terminate();
  }

  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("WebSocket server", () => {
  it("sends the same room view as the web app, with no viewer", async () => {
    const { messages } = subscribe(`roomId=${code}`);
    const first = await waitFor(() => roomMessages(messages)[0]);

    const stored = (await findStoredRoom(code))!;
    const expected = JSON.parse(JSON.stringify(roomToView(stored, null)));

    assert.deepEqual(first.room, expected);
    assert.equal((first.room as { viewer: unknown }).viewer, null);
  });

  it("takes nothing about the player from the address: a player id in the URL changes nothing", async () => {
    const anonymous = subscribe(`roomId=${code}`);
    const claimsHost = subscribe(`roomId=${code}&telegramId=${host.telegramId}`);
    const claimsGuest = subscribe(`roomId=${code}&telegramId=${guest.telegramId}&kind=queue`);

    const [first, hostClaim, guestClaim] = await Promise.all([
      waitFor(() => roomMessages(anonymous.messages)[0]),
      waitFor(() => roomMessages(claimsHost.messages)[0]),
      waitFor(() => roomMessages(claimsGuest.messages)[0])
    ]);

    assert.deepEqual(hostClaim, first);
    assert.deepEqual(guestClaim, first);
    assert.equal((guestClaim.room as { viewer: unknown }).viewer, null);
  });

  it("does not send Telegram data about the players, not even their ids", async () => {
    const { messages } = subscribe(`roomId=${code}`);
    const first = await waitFor(() => roomMessages(messages)[0]);
    const json = JSON.stringify(first);

    for (const field of ["telegramId", "telegramName", "telegramUsername", "telegramPhotoUrl", "colorAssignments", "spectators", "moves"]) {
      assert.ok(!json.includes(field), field);
    }
  });

  it("gives the colors of both players, so a browser can work out its own", async () => {
    const { messages } = subscribe(`roomId=${code}`);
    const first = await waitFor(() => roomMessages(messages)[0]);

    assert.equal((first.room as { hostColor: string }).hostColor, "red");
    assert.equal((first.room as { guestColor: string }).guestColor, "green");
  });

  it("answers an unknown room with an empty room", async () => {
    const { messages } = subscribe("roomId=NOSUCHROOM");
    const first = await waitFor(() => roomMessages(messages)[0]);

    assert.equal(first.room, null);
  });

  it("pushes an update when the room changes", async () => {
    const { messages } = subscribe(`roomId=${code}`);
    await waitFor(() => roomMessages(messages)[0]);

    await makeMove(code, guest, 4);

    const updated = await waitFor(() =>
      roomMessages(messages).find((message) => {
        const board = (message.room as { board: (string | null)[][] }).board;
        return board[board.length - 1][4] === "green";
      })
    );

    assert.equal((updated.room as { turnColor: string }).turnColor, "red");
  });

  it("listens on 127.0.0.1 unless WS_HOST says otherwise", async () => {
    const { child, port: ownPort, banner } = await startServer("");

    try {
      assert.match(banner, new RegExp(`listening on 127\\.0\\.0\\.1:${ownPort}\\b`));

      const { messages } = (() => {
        const socket = new WebSocket(`ws://127.0.0.1:${ownPort}/?roomId=${code}`);
        const collected: RoomMessage[] = [];
        socket.on("message", (data) => collected.push(JSON.parse(String(data)) as RoomMessage));
        sockets.push(socket);
        return { messages: collected };
      })();

      const first = await waitFor(() => roomMessages(messages)[0]);
      assert.equal((first.room as { inviteCode: string }).inviteCode, code);
    } finally {
      child.kill();
    }
  });
});
