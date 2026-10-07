#!/usr/bin/env bash
# Setup script for the Claude Code cloud environment that builds Seventh Leaf's Android app
# (see docs/ANDROID.md). Paste it into the environment's setup script field. It installs the Android
# SDK once; the environment cache keeps it for later sessions.
# Needs network access "Custom" with dl.google.com listed and the default package-manager list included.
set -euo pipefail

SDK=/opt/android-sdk
if ! { mkdir -p "$SDK" 2>/dev/null && [ -w "$SDK" ]; }; then
  if sudo -n true 2>/dev/null; then
    sudo mkdir -p "$SDK" && sudo chown "$(id -u):$(id -g)" "$SDK"
  else
    SDK="$HOME/android-sdk"
    mkdir -p "$SDK"
  fi
fi

SM="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SM" ]; then
  REPO=https://dl.google.com/android/repository
  ZIP=""
  for list in repository2-3.xml repository2-1.xml; do
    ZIP=$(curl -fsSL "$REPO/$list" 2>/dev/null | grep -o 'commandlinetools-linux-[0-9]*_latest\.zip' | sort -t- -k3 -n | tail -1 || true)
    [ -n "$ZIP" ] && break
  done
  [ -n "$ZIP" ] || { echo "Could not find the Android command-line tools: is dl.google.com allowed?" >&2; exit 1; }
  curl -fsSL -o /tmp/cmdline-tools.zip "$REPO/$ZIP"
  rm -rf "$SDK/cmdline-tools" /tmp/cmdline-tools-x
  mkdir -p "$SDK/cmdline-tools" /tmp/cmdline-tools-x
  if command -v unzip >/dev/null; then
    unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-x
  else
    python3 -m zipfile -e /tmp/cmdline-tools.zip /tmp/cmdline-tools-x
    chmod +x /tmp/cmdline-tools-x/cmdline-tools/bin/*   # Python's zipfile drops the executable bit
  fi
  mv /tmp/cmdline-tools-x/cmdline-tools "$SDK/cmdline-tools/latest"
  rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools-x
fi

# `yes` ends with a broken pipe once the licences are accepted, so its exit status is ignored
yes | "$SM" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SM" --sdk_root="$SDK" --install "platform-tools" "platforms;android-36" >/dev/null

# build-tools 36.0.0, or the newest 36.x if that exact version is gone, or the newest of all
if ! "$SM" --sdk_root="$SDK" --install "build-tools;36.0.0" >/dev/null 2>&1; then
  BT=$("$SM" --sdk_root="$SDK" --list 2>/dev/null | grep -o 'build-tools;36[0-9.]*' | sort -V | tail -1 || true)
  [ -n "$BT" ] || BT=$("$SM" --sdk_root="$SDK" --list 2>/dev/null | grep -o 'build-tools;[0-9.]*' | sort -V | tail -1)
  "$SM" --sdk_root="$SDK" --install "$BT" >/dev/null
fi

echo "Android SDK ready at $SDK"
