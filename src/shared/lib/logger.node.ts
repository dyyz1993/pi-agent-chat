import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

let _logDir: string | null = null;

export function configureLogDir(dir: string): void {
  _logDir = dir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getLogDir(): string {
  if (!_logDir) {
    _logDir = "logs";
    if (!existsSync(_logDir)) {
      mkdirSync(_logDir, { recursive: true });
    }
  }
  return _logDir;
}

export function writeLogLine(line: string): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(getLogDir(), `${date}.log`);
    appendFileSync(filePath, `${line}\n`);
  } catch { /* logger write failed — must not recurse */ }
}
