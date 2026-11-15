# Грыжа межпозвонкового диска — тестовый motion-ролик

Тестовый ролик, сделанный по навыку `vizavi_motion` v1.6.1.

- `out/hernia.mp4` — готовое видео: 1920×1080, 60 fps, H.264 yuv420p, AAC 48 кГц, 26,67 с (1600 кадров).
- `storyboard.md` — идея, по 3–4 варианта на каждую сцену с выбором, карточки планов, синхроточки.
- `scene.html` — вся анимация: Canvas 2D, собственный таймлайн `renderFrame(i)` и ортографическая 3D-проекция призм с ламбертовым светом. Также motion blur субкадрами, DOF слоями и радиальный blur на ударах. Предпросмотр: `scene.html?play` или `scene.html?t=12.5` через любой локальный сервер.
- `audio.js` — музыка (Dm, 90 BPM) и SFX, синтезированные офлайн через `OfflineAudioContext`.
- `render.mjs` — Playwright и локальный HTTP-сервер: стоп-кадры, все кадры (4 воркера), WAV.

## Сборка

```bash
npm i                      # шрифты @fontsource (в fonts/ уже лежат копии)
node render.mjs audio      # out/audio.wav
node render.mjs frames     # frames/f_00000.png … f_01599.png
ffmpeg -framerate 60 -i frames/f_%05d.png -i out/audio.wav \
  -af "volume=4dB,alimiter=limit=0.89:level=false" \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart out/hernia.mp4
```

## Ассеты и лицензии

- Шрифты Unbounded и Manrope — SIL Open Font License 1.1, пакеты `@fontsource/unbounded@5` и `@fontsource/manrope@5`.
- Графика, музыка и звуки созданы кодом в этом репозитории. Сторонних моделей, изображений и сэмплов нет.

Учебная анимация, она не заменяет консультацию врача.
