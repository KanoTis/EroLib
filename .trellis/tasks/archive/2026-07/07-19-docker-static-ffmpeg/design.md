# Design: docker-static-ffmpeg

## Why GPL static

```ts
// apps/server/src/providers/ffmpeg.ts
"-acodec", "libmp3lame"  // requires GPL build
```

LGPL BtbN builds omit mp3 encoder → Erovoice fails.

## Stage

```
ffmpeg-fetch:
  curl BtbN linux64-gpl.tar.xz
  extract bin/ffmpeg → /out/ffmpeg
  smoke: -version; -encoders | grep libmp3lame

runtime:
  apt: ca-certificates only
  COPY ffmpeg → /usr/local/bin/ffmpeg
  ENV FFMPEG_PATH=/usr/local/bin/ffmpeg  # optional, PATH also works
```

## URL

Default:
`https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz`

Override: `docker build --build-arg FFMPEG_URL=...`

Archive layout (BtbN): top dir `ffmpeg-master-latest-linux64-gpl/bin/ffmpeg`.
