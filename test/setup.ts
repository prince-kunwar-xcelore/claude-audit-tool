import { setLogger } from '../src/logger.js';
import type { Logger } from '../src/logger.js';

const noop = () => {};
const nullLogger: Logger = {
  filePath: '',
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  section: noop,
  close: () => Promise.resolve(),
};

setLogger(nullLogger);
