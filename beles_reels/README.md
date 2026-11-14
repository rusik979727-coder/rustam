# BELES Reels — «Қайырлы күн»

`out/BELES_kaiyrly_kun_reels.mp4` — 1080×1920, 30 FPS, H.264, 10 s, AAC 48 kHz, −14 LUFS.

Қайта жасау (assets = Inter шрифттері, `logo.png`, `whoosh-short.mp3`, `pop.mp3`
— `claude/video-logo-music-jm6tcn` тармағының `project/assets/` бумасынан):

```bash
python3 render.py SOURCE.mov ASSETS_DIR tmp.mp4      # tmp.mp4.video.mp4 жасайды
./mix.sh SOURCE.mov ASSETS_DIR tmp.mp4.video.mp4 out/BELES_kaiyrly_kun_reels.mp4
```

SFX: Pixabay Content License (коммерциялық қолдануға рұқсат).
