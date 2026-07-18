#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/backend/server.js" &
node "$DIR/frontend-admin/server.js" &
node "$DIR/frontend-tecnico/server.js" &
echo "Admin: http://localhost:5173"
echo "Técnico: http://localhost:5174"
echo "API: http://localhost:4000"
wait
