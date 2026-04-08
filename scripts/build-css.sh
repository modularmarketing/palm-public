#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

npx tailwindcss --input styles/dashboard.css --output styles/dashboard.out.css --content 'lib/assembler.js'
echo "Built $(wc -c < styles/dashboard.out.css | tr -d ' ') bytes -> styles/dashboard.out.css"
