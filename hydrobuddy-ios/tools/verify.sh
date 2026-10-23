#!/usr/bin/env bash
# Everything that can be checked without a Mac. Run from hydrobuddy-ios/.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== regenerating content from the web app =="
node tools/gen-content.mjs
node tools/gen-vectors.mjs

echo "== project graph =="
python3 tools/gen_xcodeproj.py
python3 tools/check_pbxproj.py

echo "== swift references =="
python3 tools/check_swift_refs.py

if ! git diff --quiet -- HydroBuddy/CoachContent.swift; then
  echo "NOTE: generated coach content changed — commit it."
fi
echo "OK (a Mac still has to run the compiler and the tests)"
