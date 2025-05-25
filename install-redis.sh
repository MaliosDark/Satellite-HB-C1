#!/usr/bin/env bash
set -euo pipefail

# 1) Clone and build Redis in vendor/redis
if [ ! -d vendor/redis ]; then
  echo "🔄 Cloning Redis into vendor/redis…"
  git clone https://github.com/redis/redis.git vendor/redis
else
  echo "✅ vendor/redis already exists, skipping clone"
fi

echo "🔄 Building Redis…"
cd vendor/redis
make -j "$(nproc)"
cd ../../

# 2) Launch embedded Redis
REDIS_BIN="vendor/redis/src/redis-server"
if [ ! -x "$REDIS_BIN" ]; then
  echo "❌ Could not find redis-server binary at $REDIS_BIN"
  exit 1
fi

echo "🔄 Starting Redis on port 6379 (maxclients=10000)…"
"$REDIS_BIN" --port 6379 --maxclients 10000 &
REDIS_PID=$!

# Give Redis a moment to start
sleep 0.5
echo "✅ Redis started (PID: $REDIS_PID)"

# 3) Initialize database and bootstrap agents
echo "🔄 Running database initialization…"
npm run init-db

echo "🔄 Bootstrapping agents…"
npm run bootstrap

# 4) Launch the Satellite process
echo "🔄 Launching PAi-OS Satellite…"
npm run satellite

# 5) On exit, shut down Redis
echo "🔄 Shutting down Redis (PID: $REDIS_PID)…"
kill "$REDIS_PID"

echo "✅ All processes stopped. Goodbye!"
