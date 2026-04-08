#!/usr/bin/env bash
# scripts/pre-commit-hook.sh — Block proprietary terms from entering the public repo
# Also installed as scripts/hooks/pre-commit via: git config core.hooksPath scripts/hooks
#
# Setup: After cloning, run:
#   git config core.hooksPath scripts/hooks
# This activates the hook for all commits in this repo.

BLOCKED_TERMS_FILE="$(git rev-parse --show-toplevel)/scripts/blocked-terms.txt"

if [ ! -f "$BLOCKED_TERMS_FILE" ]; then
  echo "WARNING: blocked-terms.txt not found at $BLOCKED_TERMS_FILE"
  exit 0
fi

# Build grep pattern from file (one term per line, skip comments and blanks)
PATTERN=$(grep -v '^#' "$BLOCKED_TERMS_FILE" | grep -v '^\s*$' | paste -sd '|' -)

if [ -z "$PATTERN" ]; then
  exit 0
fi

# Check only staged files (not the entire working tree)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FOUND=""
for file in $STAGED_FILES; do
  # Skip binary files and the blocked-terms file itself
  if file "$file" | grep -q "text"; then
    MATCHES=$(git show ":$file" | grep -inE "$PATTERN" || true)
    if [ -n "$MATCHES" ]; then
      FOUND="$FOUND\n$file:\n$MATCHES\n"
    fi
  fi
done

if [ -n "$FOUND" ]; then
  echo "BLOCKED: Proprietary terms found in staged files:"
  echo -e "$FOUND"
  echo ""
  echo "Remove these references before committing."
  echo "Blocked terms defined in: $BLOCKED_TERMS_FILE"
  exit 1
fi

exit 0
