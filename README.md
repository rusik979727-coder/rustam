# rustam

## skills/ghost-editor

Claude Code skill: one talking-head recording in, one finished short out.
Creative work = choosing takes and planning rhythm in `edit.json`; cutting, zoom animation,
captions, SFX levels, asset copying and QC are done by the scripts, identically every time.

```bash
skills/ghost-editor/install.sh          # symlink into ~/.claude/skills/ghost-editor
```

See [skills/ghost-editor/SKILL.md](skills/ghost-editor/SKILL.md). Requires ffmpeg (with libass), Node 18+,
and faster-whisper or openai-whisper for transcription.
