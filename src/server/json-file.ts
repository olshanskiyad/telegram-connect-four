import { randomUUID } from "crypto";
import { mkdir, rename, rm, writeFile } from "fs/promises";
import path from "path";

/**
 * Writes a JSON file so that a reader (this app or ws-server.mjs) never sees a half-written file:
 * the data goes to a temporary file in the same folder and is moved over the old file in one step.
 */
export async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });

  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * JSON.parse for data files that never quotes the file in the error: on broken JSON V8 puts a piece of the
 * input into the message, and a data file holds players' names. Routes return error texts to clients.
 */
export function parseJsonFile(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Data file ${path.basename(file)} is corrupted`);
  }
}
