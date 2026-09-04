#!/bin/sh
set -eu

cd /code
HOST=0.0.0.0 PORT="${PORT:-9000}" NODE_ENV=production node server/index.js
