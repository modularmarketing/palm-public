#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "[build] Step 1: Compile Tailwind CSS" >&2
bash scripts/build-css.sh

echo "[build] Step 2: Generate assets bundle" >&2
node scripts/generate-assets-bundle.js

echo "[build] Step 3: Compile binaries" >&2
mkdir -p dist

bun build --compile --target=bun-darwin-arm64 src/mcp-server.ts --outfile dist/palm-mcp-darwin-arm64
bun build --compile --target=bun-darwin-x64   src/mcp-server.ts --outfile dist/palm-mcp-darwin-x64
bun build --compile --target=bun-windows-x64  src/mcp-server.ts --outfile dist/palm-mcp-windows-x64

echo "[build] Done. Binaries in dist/" >&2
ls -lh dist/palm-mcp-* >&2
