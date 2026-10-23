import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { getTelegramAuthMaxAgeSeconds } from "@/server/config";
import { authenticateTelegramUser, authenticateUser, changeNickname, openGuestSession } from "@/server/profile/service";
import { createRoom } from "@/server/rooms/service";
import { getRatingLeaderboard, recordBotMatchResult } from "@/server/stats/service";

import { signInitData } from "./telegram";

const BOT_TOKEN = "test-bot-token";
let dataDir = "";

before(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  delete process.env.GUEST_MODE;
  delete process.env.TELEGRAM_AUTH_MAX_AGE;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function initDataFor(user: object, authDate = Math.floor(Date.now() / 1000), botToken = BOT_TOKEN): string {
  return signInitData({ auth_date: String(authDate), query_id: "test-query", user: JSON.stringify(user) }, botToken);
}

describe("sign-in with Telegram", () => {
  it("creates and then updates the profile of a verified user", async () => {
    const user = { id: 4242, first_name: "Test", last_name: "User", username: "test_user" };
    const profile = await authenticateTelegramUser(initDataFor(user));

    assert.equal(profile.telegramId, 4242);
    assert.equal(profile.telegramName, "Test User");
    assert.equal(profile.telegramUsername, "test_user");
    assert.match(profile.nickname, /^Игрок \d{4}$/, "a neutral nickname, not the Telegram name");

    const renamed = await authenticateUser(initDataFor({ ...user, username: "new_name" }));
    assert.equal(renamed.telegramUsername, "new_name");
    assert.equal(renamed.nickname, profile.nickname, "the nickname stays the same on the next sign-in");
  });

  it("shows other players and the public rating only the nickname, never the Telegram name", async () => {
    const user = { id: 4246, first_name: "Private", last_name: "Person", username: "private_person" };
    const profile = await authenticateTelegramUser(initDataFor(user));
    await recordBotMatchResult(profile, "win", "login-test-1");

    let rating = JSON.stringify(await getRatingLeaderboard());
    assert.ok(rating.includes(profile.nickname));
    for (const secret of ["Private", "Person", "private_person"]) {
      assert.ok(!rating.includes(secret), secret);
    }

    await changeNickname(initDataFor(user), "Мастер");
    rating = JSON.stringify(await getRatingLeaderboard());
    assert.ok(rating.includes("Мастер") && !rating.includes(profile.nickname));
  });

  it("rejects data signed with another token, and old data", async () => {
    const user = { id: 4243, first_name: "Other" };
    const longAgo = Math.floor(Date.now() / 1000) - 3 * 86400;

    await assert.rejects(authenticateUser(initDataFor(user, undefined, "another-bot-token")), /verification failed/);
    await assert.rejects(authenticateUser(initDataFor(user, longAgo)), /expired/);
  });

  it("does not accept guest tokens while a bot token is set and guest mode is not switched on", async () => {
    await assert.rejects(openGuestSession(), /disabled/);
    await assert.rejects(authenticateUser(`guest.-1.${"0".repeat(64)}`), /disabled/);
  });

  it("keeps rooms working with Telegram profiles", async () => {
    const profile = await authenticateTelegramUser(initDataFor({ id: 4244, first_name: "Host" }));
    const room = await createRoom(profile);

    assert.equal(room.status, "lobby");
    assert.equal(room.host.nickname, profile.nickname);
    assert.equal(room.viewer?.telegramId, 4244);
  });
});

describe("initData age setting", () => {
  it("defaults to one day and can be changed or switched off", () => {
    delete process.env.TELEGRAM_AUTH_MAX_AGE;
    assert.equal(getTelegramAuthMaxAgeSeconds(), 86400);

    process.env.TELEGRAM_AUTH_MAX_AGE = "600";
    assert.equal(getTelegramAuthMaxAgeSeconds(), 600);

    process.env.TELEGRAM_AUTH_MAX_AGE = "0";
    assert.equal(getTelegramAuthMaxAgeSeconds(), 0);

    process.env.TELEGRAM_AUTH_MAX_AGE = "not a number";
    assert.equal(getTelegramAuthMaxAgeSeconds(), 86400);

    delete process.env.TELEGRAM_AUTH_MAX_AGE;
  });
});
