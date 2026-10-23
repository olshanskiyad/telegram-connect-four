import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { getGuestSecret } from "@/server/auth/guest-secret";
import { signGuestToken, verifyGuestToken } from "@/server/auth/guest";
import { isGuestModeEnabled } from "@/server/config";
import { getMatchmakingStatus, joinMatchmakingQueue } from "@/server/matchmaking/service";
import { authenticateUser, changeNickname, openGuestSession } from "@/server/profile/service";
import { createRoom, getRoom, joinRoom, makeMove, restartRoom, updateRoomColor } from "@/server/rooms/service";
import { getRatingLeaderboard, isValidMatchId, recordBotMatchResult } from "@/server/stats/service";

let dataDir = "";

before(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.GUEST_MODE = "true";
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GUEST_SECRET;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function newGuest() {
  return (await openGuestSession()).profile;
}

describe("guest sessions", () => {
  it("creates guests with negative, distinct ids and a signed token", async () => {
    const first = await openGuestSession();
    const second = await openGuestSession();

    assert.ok(first.profile.telegramId < 0);
    assert.ok(second.profile.telegramId < first.profile.telegramId);
    assert.match(first.profile.nickname, /^Гость \d{4}$/);
    assert.equal(first.profile.telegramUsername, null);
    assert.equal(first.profile.telegramPhotoUrl, null);
    assert.equal(verifyGuestToken(first.token, await getGuestSecret()), first.profile.telegramId);
  });

  it("gives back the same guest for its saved token and a new guest for a forged one", async () => {
    const first = await openGuestSession();
    const again = await openGuestSession(first.token);
    const forged = await openGuestSession(first.token.slice(0, -1) + (first.token.endsWith("0") ? "1" : "0"));

    assert.equal(again.profile.telegramId, first.profile.telegramId);
    assert.equal(again.token, first.token);
    assert.notEqual(forged.profile.telegramId, first.profile.telegramId);
  });

  it("creates a new guest when the saved one is gone, for example after the data was reset", async () => {
    const orphanToken = signGuestToken(-424242, await getGuestSecret());
    const session = await openGuestSession(orphanToken);

    assert.notEqual(session.profile.telegramId, -424242);
    assert.notEqual(session.token, orphanToken);
    await assert.rejects(authenticateUser(orphanToken), /not found/);
  });

  it("signs in with the token and refuses a made-up one", async () => {
    const { profile, token } = await openGuestSession();

    assert.equal((await authenticateUser(token)).telegramId, profile.telegramId);
    await assert.rejects(authenticateUser("guest.-1.abc"), /invalid/);
    await assert.rejects(authenticateUser(`guest.-99999.${"0".repeat(64)}`), /invalid/);
  });

  it("refuses guests when guest mode is off", async () => {
    const { token } = await openGuestSession();

    process.env.GUEST_MODE = "false";
    try {
      await assert.rejects(openGuestSession(), /disabled/);
      await assert.rejects(authenticateUser(token), /disabled/);
    } finally {
      process.env.GUEST_MODE = "true";
    }
  });

  it("lets a guest change the nickname within the rules", async () => {
    const { token } = await openGuestSession();

    assert.equal((await changeNickname(token, "Мастер")).nickname, "Мастер");
    await assert.rejects(changeNickname(token, "x"), /короткий/);
    await assert.rejects(changeNickname(token, "<script>"), /только буквы/);
  });
});

describe("two guests in a private room", () => {
  it("play to a win, with only nicknames visible and the result in the rating", async () => {
    const host = await newGuest();
    const guest = await newGuest();
    const watcher = await newGuest();

    let room = await createRoom(host);
    const code = room.inviteCode;
    assert.equal(room.status, "lobby");
    assert.equal(room.viewer?.role, "host");

    room = await joinRoom(code, guest);
    assert.equal(room.viewer?.role, "guest");
    assert.equal(room.playerCount, 2);

    room = await updateRoomColor(code, host, "red");
    assert.equal(room.status, "active");
    assert.equal(room.hostColor, "red");
    assert.equal(room.guestColor, "green");
    assert.equal(room.turnColor, "red");

    assert.equal((await joinRoom(code, watcher)).viewer?.role, "spectator");
    await assert.rejects(makeMove(code, watcher, 0), /Only room players/);
    await assert.rejects(makeMove(code, guest, 0), /not this player's turn/);

    // Red builds the bottom row, green stacks on top of it. Red completes four first.
    const moves: Array<[typeof host, number]> = [
      [host, 0], [guest, 0], [host, 1], [guest, 1], [host, 2], [guest, 2], [host, 3]
    ];

    for (const [player, column] of moves) {
      room = await makeMove(code, player, column);
    }

    assert.equal(room.status, "finished");
    assert.ok(room.result?.kind === "win" && room.result.winner === "red");
    assert.deepEqual(room.score, { host: 1, guest: 0 });
    await assert.rejects(makeMove(code, guest, 4), /Finished rooms/);

    // What the browser gets contains no Telegram data about the players.
    const view = (await getRoom(code))!;
    assert.deepEqual(Object.keys(view.host).sort(), ["joinedAt", "lastSeenAt", "nickname"]);
    assert.deepEqual(Object.keys(view.guest!).sort(), ["joinedAt", "lastSeenAt", "nickname"]);
    const json = JSON.stringify(view);
    for (const field of ["telegramName", "telegramUsername", "telegramPhotoUrl", "colorAssignments"]) {
      assert.ok(!json.includes(field), field);
    }

    const rating = await getRatingLeaderboard();
    const hostRow = rating.leaderboard.find((row) => row.nickname === host.nickname);
    const guestRow = rating.leaderboard.find((row) => row.nickname === guest.nickname);
    assert.ok(hostRow && hostRow.wins === 1 && hostRow.losses === 0);
    assert.ok(guestRow && guestRow.losses === 1 && guestRow.wins === 0);
    assert.ok(rating.leaderboard.every((row) => !("telegramId" in row)));
  });

  it("rejects a move into a full column and keeps the turn", async () => {
    const host = await newGuest();
    const guest = await newGuest();

    const created = await createRoom(host);
    const code = created.inviteCode;
    await joinRoom(code, guest);
    await updateRoomColor(code, host, "red");

    // Six alternating discs fill column 0 without four in a column.
    const players = [host, guest, host, guest, host, guest];
    for (const player of players) {
      await makeMove(code, player, 0);
    }

    await assert.rejects(makeMove(code, host, 0), /column is full/);

    const room = await makeMove(code, host, 1);
    assert.equal(room.turnColor, "green");
  });

  it("starts a new round with an empty board and keeps the score", async () => {
    const host = await newGuest();
    const guest = await newGuest();

    const created = await createRoom(host);
    const code = created.inviteCode;
    await joinRoom(code, guest);
    await updateRoomColor(code, host, "red");

    let room = created;
    for (const [player, column] of [[host, 0], [guest, 0], [host, 1], [guest, 1], [host, 2], [guest, 2], [host, 3]] as const) {
      room = await makeMove(code, player, column);
    }
    assert.equal(room.status, "finished");

    room = await restartRoom(code, guest);
    assert.equal(room.status, "lobby");
    assert.ok(room.board.every((row) => row.every((cell) => cell === null)));
    assert.equal(room.result, null);
    assert.deepEqual(room.score, { host: 1, guest: 0 });
    assert.notEqual(room.currentMatchId, created.currentMatchId);
  });

  it("counts a result against the bot once per match id", async () => {
    const player = await newGuest();

    assert.equal(await recordBotMatchResult(player, "win", "match-1"), true);
    assert.equal(await recordBotMatchResult(player, "win", "match-1"), false, "already counted");
    assert.equal(await recordBotMatchResult(player, "draw", "match-2"), true);

    const row = (await getRatingLeaderboard()).leaderboard.find((entry) => entry.nickname === player.nickname);
    assert.ok(row && row.wins === 1 && row.draws === 1 && row.gamesPlayed === 2);
  });
});

describe("results and the rating", () => {
  it("reading the rating does not rewrite stats.json or rooms.json when nothing is new", async () => {
    const host = await newGuest();
    const guest = await newGuest();
    const created = await createRoom(host);
    const code = created.inviteCode;
    await joinRoom(code, guest);
    await updateRoomColor(code, host, "red");
    for (const [player, column] of [[host, 0], [guest, 0], [host, 1], [guest, 1], [host, 2], [guest, 2], [host, 3]] as const) {
      await makeMove(code, player, column);
    }

    await getRatingLeaderboard(); // may record what is still missing
    const files = ["stats.json", "rooms.json"].map((name) => path.join(dataDir, name));
    const before = files.map((file) => ({ ino: statSync(file).ino, mtimeMs: statSync(file).mtimeMs, text: readFileSync(file, "utf8") }));

    await getRatingLeaderboard();
    await getRatingLeaderboard();

    files.forEach((file, index) => {
      assert.equal(statSync(file).ino, before[index].ino, `${path.basename(file)} was replaced`);
      assert.equal(statSync(file).mtimeMs, before[index].mtimeMs, `${path.basename(file)} was written`);
      assert.equal(readFileSync(file, "utf8"), before[index].text);
    });
  });

  it("accepts a UUID or up to 64 safe characters as a match id", () => {
    assert.equal(isValidMatchId("3f2b8a9e-6c1d-4e55-9a07-2b7d5c1e8f40"), true);
    assert.equal(isValidMatchId("bot-1-abc_DEF"), true);
    assert.equal(isValidMatchId("a".repeat(64)), true);

    for (const bad of ["", "a".repeat(65), "has space", "colon:inside", "slash/inside", "quote'", "новый", "line\nbreak", "dot.dot"]) {
      assert.equal(isValidMatchId(bad), false, JSON.stringify(bad));
    }
  });

  it("refuses to count a result with a bad match id", async () => {
    const player = await newGuest();

    for (const bad of ["", "x".repeat(65), "a:b", "with space"]) {
      await assert.rejects(recordBotMatchResult(player, "win", bad), /Match ID is invalid/, JSON.stringify(bad));
    }

    const row = (await getRatingLeaderboard()).leaderboard.find((entry) => entry.nickname === player.nickname);
    assert.equal(row, undefined, "nothing was counted");
  });
});

describe("a new round", () => {
  it("is refused while the game is not finished", async () => {
    const host = await newGuest();
    const guest = await newGuest();
    const created = await createRoom(host);
    const code = created.inviteCode;

    await assert.rejects(restartRoom(code, host), /only start after the game is finished/, "lobby, alone");

    await joinRoom(code, guest);
    await assert.rejects(restartRoom(code, guest), /only start after the game is finished/, "lobby with two players");

    await updateRoomColor(code, host, "red");
    await makeMove(code, host, 3);
    await assert.rejects(restartRoom(code, host), /only start after the game is finished/, "game in progress");

    const room = (await getRoom(code))!;
    assert.equal(room.status, "active");
    assert.equal(room.board[5][3], "red", "the board was not reset");
  });

  it("is still for the players only", async () => {
    const host = await newGuest();
    const stranger = await newGuest();
    const created = await createRoom(host);

    await assert.rejects(restartRoom(created.inviteCode, stranger), /Only room players/);
  });
});

describe("random opponent", () => {
  it("pairs two guests in an active room", async () => {
    const first = await newGuest();
    const second = await newGuest();

    const waiting = await joinMatchmakingQueue(first);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.room, null);

    const matched = await joinMatchmakingQueue(second);
    assert.equal(matched.status, "matched");
    assert.equal(matched.room?.status, "active");
    assert.equal(matched.room?.playerCount, 2);

    const forFirst = await getMatchmakingStatus(first);
    assert.equal(forFirst.status, "matched");
    assert.equal(forFirst.room?.inviteCode, matched.room?.inviteCode);
  });
});

describe("guest mode setting", () => {
  it("is on by default only while there is no bot token", () => {
    const saved = { mode: process.env.GUEST_MODE, token: process.env.TELEGRAM_BOT_TOKEN };

    try {
      delete process.env.GUEST_MODE;
      delete process.env.TELEGRAM_BOT_TOKEN;
      assert.equal(isGuestModeEnabled(), true);

      process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
      assert.equal(isGuestModeEnabled(), false);

      process.env.GUEST_MODE = "true";
      assert.equal(isGuestModeEnabled(), true);

      process.env.GUEST_MODE = "false";
      delete process.env.TELEGRAM_BOT_TOKEN;
      assert.equal(isGuestModeEnabled(), false);
    } finally {
      process.env.GUEST_MODE = saved.mode;
      if (saved.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = saved.token;
    }
  });
});
