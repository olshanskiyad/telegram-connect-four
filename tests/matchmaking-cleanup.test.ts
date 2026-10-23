import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { cancelMatchmakingQueue, getMatchmakingStatus, joinMatchmakingQueue } from "@/server/matchmaking/service";
import { upsertTelegramProfile, type StoredProfile } from "@/server/profile/store";

import { HOUR, MINUTE } from "./rooms";

type Entry = { telegramId: number; joinedAt: string; matchedAt: string | null };

let dataDir = "";
let alice: StoredProfile;
let bob: StoredProfile;
let carol: StoredProfile;

const file = () => path.join(dataDir, "matchmaking.json");
const raw = () => readFileSync(file(), "utf8");
const entries = () => (JSON.parse(raw()) as { entries: Entry[] }).entries;

function rewriteEntries(change: (entry: Entry) => void): void {
  const store = JSON.parse(raw()) as { entries: Entry[] };
  store.entries.forEach(change);
  writeFileSync(file(), JSON.stringify(store, null, 2));
}

const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

before(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
  process.env.DATA_DIR = dataDir;

  alice = await upsertTelegramProfile({ id: 6001, first_name: "Queue", last_name: "Alice", username: "queue_alice" });
  bob = await upsertTelegramProfile({ id: 6002, first_name: "Queue", last_name: "Bob", username: "queue_bob" });
  carol = await upsertTelegramProfile({ id: 6003, first_name: "Queue", last_name: "Carol", username: "queue_carol" });
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("matchmaking.json holds a profile copy only as long as it is needed", () => {
  it("drops a waiting entry after 30 minutes, from the file as well as from the answer", async () => {
    await joinMatchmakingQueue(alice);
    assert.ok(raw().includes("queue_alice"));

    rewriteEntries((entry) => {
      entry.joinedAt = agoIso(31 * MINUTE);
    });

    const status = await getMatchmakingStatus(carol);

    assert.equal(status.waitingCount, 0);
    assert.equal(entries().length, 0);
    assert.ok(!raw().includes("queue_alice"), "the profile copy is gone from the file");
  });

  it("keeps a waiting entry that is younger than 30 minutes, and a status check does not rewrite the file", async () => {
    await joinMatchmakingQueue(alice);
    rewriteEntries((entry) => {
      entry.joinedAt = agoIso(29 * MINUTE);
    });
    const before = statSync(file());

    const status = await getMatchmakingStatus(carol);
    const after = statSync(file());

    assert.equal(status.waitingCount, 1);
    assert.equal(entries().length, 1);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);

    await cancelMatchmakingQueue(alice);
    assert.equal(entries().length, 0);
  });

  it("drops matched entries after 24 hours", async () => {
    await joinMatchmakingQueue(alice);
    const matched = await joinMatchmakingQueue(bob);
    assert.equal(matched.status, "matched");
    assert.equal(entries().length, 2);

    rewriteEntries((entry) => {
      entry.matchedAt = agoIso(25 * HOUR);
    });

    await getMatchmakingStatus(carol);

    assert.equal(entries().length, 0);
    assert.ok(!raw().includes("queue_alice") && !raw().includes("queue_bob"));
  });

  it("keeps matched entries younger than 24 hours", async () => {
    await joinMatchmakingQueue(alice);
    await joinMatchmakingQueue(bob);
    rewriteEntries((entry) => {
      entry.matchedAt = agoIso(23 * HOUR);
    });

    await getMatchmakingStatus(carol);

    assert.equal(entries().length, 2);
  });
});
