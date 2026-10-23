import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isGuestToken, signGuestToken, verifyGuestToken } from "@/server/auth/guest";

const SECRET = "test-secret";

describe("guest token", () => {
  it("is verified back to the same negative id", () => {
    const token = signGuestToken(-7, SECRET);

    assert.ok(isGuestToken(token));
    assert.equal(verifyGuestToken(token, SECRET), -7);
  });

  it("is not accepted with another secret", () => {
    const token = signGuestToken(-7, SECRET);

    assert.throws(() => verifyGuestToken(token, "other-secret"), /invalid/);
  });

  it("cannot be moved to another guest id", () => {
    const [prefix, , signature] = signGuestToken(-7, SECRET).split(".");

    assert.throws(() => verifyGuestToken(`${prefix}.-8.${signature}`, SECRET), /invalid/);
  });

  it("cannot name a Telegram (positive) id or an id of zero", () => {
    const signature = signGuestToken(-7, SECRET).split(".")[2];

    assert.throws(() => signGuestToken(7, SECRET), /negative/);
    assert.throws(() => signGuestToken(0, SECRET), /negative/);
    assert.throws(() => verifyGuestToken(`guest.7.${signature}`, SECRET), /invalid/);
    assert.throws(() => verifyGuestToken(`guest.0.${signature}`, SECRET), /invalid/);
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "guest.", "guest.-1", "guest.-1.zz", "guest.-1.", "user.-1.abc", `guest.-1.${"a".repeat(63)}`]) {
      assert.throws(() => verifyGuestToken(token, SECRET), /invalid/, token);
    }
  });

  it("is told apart from Telegram initData", () => {
    assert.equal(isGuestToken("query_id=x&user=%7B%7D&auth_date=1&hash=abc"), false);
    assert.equal(isGuestToken(""), false);
  });
});
