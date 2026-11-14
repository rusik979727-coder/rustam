#!/usr/bin/env bash
# Links this skill into ~/.claude/skills/ghost-editor so Claude Code picks it up.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/ghost-editor"
mkdir -p "$(dirname "$dest")"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "refusing to overwrite existing directory $dest" >&2; exit 1
fi
ln -sfn "$here" "$dest"
echo "ghost-editor -> $dest"
for t in ffmpeg ffprobe node; do command -v "$t" >/dev/null || echo "warning: $t not found in PATH" >&2; done
