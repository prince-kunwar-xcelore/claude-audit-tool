import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
  section: (title: string) => void;
  close: () => Promise<void>;
  filePath: string;
};

function timestamp(): string {
  return new Date().toISOString();
}

function createLogger(label: string): Logger {
  const logsDir = path.join(os.homedir(), '.pr-audit', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const filePath = path.join(logsDir, `${label}.log`);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });

  const write = (level: string, msg: string) =>
    stream.write(`[${timestamp()}] [${level}] ${msg}\n`);

  return {
    filePath,
    info: (msg) => { console.log(msg); write('INFO ', msg); },
    warn: (msg) => { console.warn(msg); write('WARN ', msg); },
    error: (msg) => { console.error(msg); write('ERROR', msg); },
    debug: (msg) => { write('DEBUG', msg); },
    section: (title) => {
      const line = `\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`;
      console.log(`\n── ${title}`);
      stream.write(`${line}\n`);
    },
    close: () => new Promise<void>((resolve) => stream.end(resolve)),
  };
}

function createNullLogger(): Logger {
  const noop = () => {};
  return {
    filePath: '',
    info: noop, warn: noop, error: noop, debug: noop,
    section: noop, close: () => Promise.resolve(),
  };
}

export let log: Logger = createNullLogger();

export function initLogger(label: string): void {
  log = createLogger(label);
}

export function setLogger(l: Logger): void {
  log = l;
}
