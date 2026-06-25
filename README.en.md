# Sonic Topography

[中文](./README.md) | English

Sonic Topography is a local music visualizer. It turns frequency bands into a glowing 3D terrain with waves, ripples, and meteors. You can play local files, the built-in demo, captured system audio, and playable QQ Music search results through the local proxy.

> Usage restriction: this project is for learning, research, and personal non-commercial use only.

![Sonic Topography main visualizer](./public/screenshots/main-visualizer.png)

## Features

- 3D audio-reactive terrain powered by Web Audio and Three.js.
- Local audio upload with optional `.lrc` lyrics.
- Built-in demo track and lyrics.
- QQ Music search through local `/api/qqmusic/*` proxy endpoints.
- QQ Music lyric, playable-url, and audio proxy support.
- Local playlists persisted across restarts.
- Visual settings for pulse effects, meteor effects, Ground EQ, custom themes, and theme rotation.
- Preset import/export for playlists and visual settings; QQ Music Cookie is excluded unless explicitly included.
- Windows single-EXE packaging through the Go server.

## Run From Source

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Local Production Run

```powershell
npm run build
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## QQ Music Cookie

Settings includes an optional QQ Music Cookie field. The app does not read your QQ Music password and cannot automatically read official-site cookies. If you need account-scoped playback attempts, copy a Cookie manually from `y.qq.com` browser requests and paste it into Settings.

Cookies are stored in browser `localStorage` and synced to the local proxy memory. They are sensitive login credentials and do not bypass copyright, membership, or regional restrictions.

## Windows Single EXE

Building the EXE requires Node.js and Go. Running the generated EXE does not require Node.js or Go.

```powershell
npm install
npm run build:go-exe
```

The executable starts a local server at `http://127.0.0.1:4173` and opens the default browser.

## Wallpaper Engine

```powershell
npm run build:wallpaper
```

Import `dist-wallpaper/index.html` as a Web wallpaper.

## Common Commands

```powershell
npm run lint
npm run build
npm start
go test ./...
npm run build:go-exe
```

## Notes

- QQ Music uses web endpoints, so playback may be affected by copyright, membership, region, and account state.
- Search results only list songs for which the proxy can obtain a playable URL.
- Local playlists are saved through `/api/playlists` and backed up in browser storage.
- Do not commit `dist/`, `dist-mac/`, `dist-wallpaper/`, `SonicTopography.exe`, or local `data/`.
