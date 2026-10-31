#!/bin/sh
# Regenerates public/offline.js from server.js mini-game logic.
cd "$(dirname "$0")/.." && { cat tools/offline_head.js; sed -n '/^const rnd/,/^\/\/ ---------------- room flow/p' server.js | grep -v '^function code()' | grep -v 'room flow'; cat tools/offline_tail.js; } > public/offline.js
