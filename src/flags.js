import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Missing or unreadable flag file: fall back to the environment defaults.
export function readFlags(file, defaults) {
  try {
    return { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

// Write to a temp file, then rename, so a crash never leaves half a file.
export function writeFlags(file, flags) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(flags, null, 2));
  renameSync(tmp, file);
}
