import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDataCheckString, buildTelegramDisplayName, verifyTelegramInitData } from "@/server/auth/telegram";

import { signInitData as sign } from "./telegram";

// Fake token for tests only. Real tokens come from @BotFather.
const BOT_TOKEN = "test-bot-token";
const AUTH_DATE = 1_000_000;

const USER = { id: 4242, first_name: "Test", last_name: "User", username: "test_user", language_code: "en" };

// initData signed with BOT_TOKEN by an independent script (Python hmac), not by the code under test.
const KNOWN_INIT_DATA =
  "auth_date=1000000&chat_instance=test-instance&chat_type=private&query_id=test-query&start_param=room-ABCD1234" +
  "&user=%7B%22id%22%3A4242%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22test_user%22%2C%22language_code%22%3A%22en%22%7D" +
  "&hash=f4d08b1151ee5173b0c555aa8a13b932f0ea1b1aefa8d0506254b2b76bd51ef9";

function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  return sign(fields, botToken);
}

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(AUTH_DATE),
    query_id: "test-query",
    user: JSON.stringify(USER),
    ...overrides
  };
}

describe("verifyTelegramInitData", () => {
  it("accepts correctly signed data and returns the user", () => {
    const result = verifyTelegramInitData(signInitData(validFields()), BOT_TOKEN);

    assert.deepEqual(result.user, USER);
    assert.equal(result.authDate, AUTH_DATE);
  });

  it("accepts a known signed example computed outside this code", () => {
    const result = verifyTelegramInitData(KNOWN_INIT_DATA, BOT_TOKEN);

    assert.equal(result.user.id, 4242);
    assert.equal(result.user.username, "test_user");
  });

  it("sorts keys with underscores and does not depend on the order of the fields", () => {
    const fields = validFields({ chat_instance: "test-instance", chat_type: "private", start_param: "room-ABCD1234" });
    const reversed = Object.fromEntries(Object.entries(fields).reverse());

    assert.ok(verifyTelegramInitData(signInitData(fields), BOT_TOKEN));
    assert.ok(verifyTelegramInitData(signInitData(reversed), BOT_TOKEN));
  });

  it("rejects data signed with another bot token", () => {
    const initData = signInitData(validFields(), "another-bot-token");

    assert.throws(() => verifyTelegramInitData(initData, BOT_TOKEN), /verification failed/);
  });

  it("rejects a changed user id", () => {
    const params = new URLSearchParams(signInitData(validFields()));
    params.set("user", JSON.stringify({ ...USER, id: 1 }));

    assert.throws(() => verifyTelegramInitData(params.toString(), BOT_TOKEN), /verification failed/);
  });

  it("rejects a field added after signing", () => {
    const initData = `${signInitData(validFields())}&extra=1`;

    assert.throws(() => verifyTelegramInitData(initData, BOT_TOKEN), /verification failed/);
  });

  it("rejects a wrong or malformed hash", () => {
    const params = new URLSearchParams(signInitData(validFields()));

    params.set("hash", "0".repeat(64));
    assert.throws(() => verifyTelegramInitData(params.toString(), BOT_TOKEN), /verification failed/);

    params.set("hash", "not-hex");
    assert.throws(() => verifyTelegramInitData(params.toString(), BOT_TOKEN), /verification failed/);
  });

  it("rejects empty input, a missing hash and a missing token", () => {
    assert.throws(() => verifyTelegramInitData("", BOT_TOKEN), /missing/);
    assert.throws(() => verifyTelegramInitData("user=%7B%7D&auth_date=1", BOT_TOKEN), /hash is missing/);
    assert.throws(() => verifyTelegramInitData(signInitData(validFields()), ""), /token is missing/);
  });

  it("rejects signed data without a user or without auth_date", () => {
    const { user: _user, ...withoutUser } = validFields();
    const { auth_date: _authDate, ...withoutDate } = validFields();

    assert.throws(() => verifyTelegramInitData(signInitData(withoutUser), BOT_TOKEN), /missing user data/);
    assert.throws(() => verifyTelegramInitData(signInitData(withoutDate), BOT_TOKEN), /missing user data/);
  });

  it("rejects a signed user that is not valid JSON or has no usable id", () => {
    for (const user of ["{broken", "null", JSON.stringify({ first_name: "No id" }), JSON.stringify({ ...USER, id: -5 })]) {
      const initData = signInitData(validFields({ user }));
      assert.throws(() => verifyTelegramInitData(initData, BOT_TOKEN), /payload is invalid/, user);
    }
  });

  it("rejects data older than the allowed age and accepts fresh data", () => {
    const initData = signInitData(validFields());
    const nowAfter = (seconds: number) => (AUTH_DATE + seconds) * 1000;

    assert.ok(verifyTelegramInitData(initData, BOT_TOKEN, { maxAgeSeconds: 3600, now: nowAfter(100) }));
    assert.throws(
      () => verifyTelegramInitData(initData, BOT_TOKEN, { maxAgeSeconds: 3600, now: nowAfter(7200) }),
      /expired/
    );
  });

  it("does not check the age when no limit is set", () => {
    const initData = signInitData(validFields());

    assert.ok(verifyTelegramInitData(initData, BOT_TOKEN, { maxAgeSeconds: 0, now: Date.now() }));
    assert.ok(verifyTelegramInitData(initData, BOT_TOKEN));
  });
});

describe("helpers", () => {
  it("builds the data-check string without the hash, keys sorted", () => {
    const params = new URLSearchParams("user=u&hash=h&auth_date=1&chat_type=c&chat=x");

    assert.equal(buildDataCheckString(params), "auth_date=1\nchat=x\nchat_type=c\nuser=u");
  });

  it("builds the display name from first and last name", () => {
    assert.equal(buildTelegramDisplayName(USER), "Test User");
    assert.equal(buildTelegramDisplayName({ id: 1, first_name: "Solo" }), "Solo");
  });
});
