#!/bin/sh
set -eu

cd /code
npm ci
npm run build
