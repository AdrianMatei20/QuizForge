#!/bin/sh
# The API container's start: make sure its database exists, migrate it, seed
# the demo data when asked (safe to run on every start), then run the API as
# the main process (exec), so it receives the container's stop signal.
set -e

node dist/database/ensure-database.js
node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js

if [ "${SEED_ON_START:-false}" = "true" ]; then
  node dist/database/seed.js
fi

exec node --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
  --import ./dist/telemetry.js dist/main.js
