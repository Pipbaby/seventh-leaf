#!/bin/sh
# Starts Seventh Leaf on this computer and opens it in your browser. On a Mac, double-click this
# file; on Linux, run: sh "Start Seventh Leaf.command". Close the window to stop Seventh Leaf.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 tools/launcher/serve.py "$@"
fi
echo
echo "  Seventh Leaf needs Python 3 to run on this computer."
echo "  Install it from https://www.python.org/downloads/ and double-click this file again."
echo
printf "  Press Return to close this window. "
read -r _
