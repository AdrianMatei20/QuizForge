import { Logger } from '@nestjs/common';

// Unit tests exercise failure paths on purpose, and the warnings they log are
// noise. Set DEBUG (e.g. `DEBUG=1 npm test`) to see them. Tests that spy on
// Logger.prototype methods still work: the spy runs before the override.
if (!process.env.DEBUG) {
  Logger.overrideLogger(false);
}
