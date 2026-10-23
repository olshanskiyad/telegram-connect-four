import path from "path";

/**
 * Directory with the JSON files of the game (profiles, rooms, stats, queue).
 * DATA_DIR overrides the default ./data. Read on every call so tests can point it at a temp folder.
 */
export function dataPath(fileName: string): string {
  const configured = process.env.DATA_DIR?.trim();
  const dir = configured ? path.resolve(configured) : path.join(process.cwd(), "data");
  return path.join(dir, fileName);
}
