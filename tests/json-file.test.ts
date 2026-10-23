import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseJsonFile, writeJsonFile } from "@/server/json-file";

let dir = "";

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "connect-four-test-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeJsonFile", () => {
  it("creates the folder, writes readable JSON and leaves no temporary file", async () => {
    const file = path.join(dir, "nested", "data.json");

    await writeJsonFile(file, { players: [1, 2, 3] });

    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { players: [1, 2, 3] });
    assert.deepEqual(readdirSync(path.dirname(file)), ["data.json"]);
  });

  it("replaces the old content as a whole", async () => {
    const file = path.join(dir, "replace.json");

    await writeJsonFile(file, { version: 1, filler: "x".repeat(5000) });
    await writeJsonFile(file, { version: 2 });

    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 2 });
  });

  it("never shows a reader a half-written file", async () => {
    const file = path.join(dir, "busy.json");
    const payload = (version: number) => ({ version, rows: Array.from({ length: 3000 }, (_, index) => ({ index, version })) });

    await writeJsonFile(file, payload(0));

    let writing = true;
    let reads = 0;
    const broken: string[] = [];

    const writer = (async () => {
      for (let version = 1; version <= 150; version += 1) {
        await writeJsonFile(file, payload(version));
      }
      writing = false;
    })();

    const reader = (async () => {
      while (writing) {
        const text = await readFile(file, "utf8");
        reads += 1;

        try {
          JSON.parse(text);
        } catch {
          broken.push(`${text.length} characters`);
        }
      }
    })();

    await Promise.all([writer, reader]);

    assert.ok(reads > 0);
    assert.deepEqual(broken, []);
  });

  it("removes the temporary file and reports the error when the write cannot finish", async () => {
    const target = path.join(dir, "blocked");
    mkdirSync(target); // a folder where the file should go: the final rename fails

    await assert.rejects(writeJsonFile(target, { ok: false }));

    assert.ok(!readdirSync(dir).some((name) => name.endsWith(".tmp")));
  });
});

describe("parseJsonFile", () => {
  it("does not quote a broken data file in the error", () => {
    const broken = '{"profiles":[{"nickname":"Secret Name"}]';
    assert.throws(() => parseJsonFile(broken, "/data/profiles.json"), (error: Error) => {
      assert.equal(error.message, "Data file profiles.json is corrupted");
      assert.ok(!error.message.includes("Secret"));
      return true;
    });
  });

  it("parses a valid file as usual", () => {
    assert.deepEqual(parseJsonFile('{"a":1}', "x.json"), { a: 1 });
  });
});
