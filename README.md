# Sonic Topography

Sonic Topography is a local music visualizer built with React, Three.js, Vite, and the Web Audio API. It plays local demos, uploads audio and `.lrc` lyrics, searches NetEase Cloud Music via a local proxy, saves browser-local playlists, and drives terrain, ripple, and meteor effects with audio frequency data.

## ✨ Features

- **3D Audio-Reactive Terrain Visualization** — Watch a living landscape pulse and flow with your music
- **Built-in Demo** — Comes with a demo track and synchronized LRC lyrics
- **Audio File Upload** — Drag & drop MP3, WAV, FLAC files with optional `.lrc` lyrics
- **NetEase Cloud Music Search** — Search and stream millions of songs, with unplayable results filtered out
- **Local Proxy Loading** — Lyrics and audio load through a local server proxy
- **Playlist Management** — Playlists saved to `data/playlists.json` (localStorage as fallback)
- **Full Playback Controls** — Previous/next track, sequential & shuffle play, delete songs/playlists with confirmation
- **Interactive Terrain** — Click & hold to create ripples, drag to rotate, scroll to zoom
- **Multiple Themes** — Nocturnal, Neon Tokyo, Cyber Forest, Minimal Monochrome
- **First-Run Onboarding Tutorial** — Guided English walkthrough for new users
- **Windows One-Click Launch** — Batch script for easy startup

## 🚀 Quick Start

### Prerequisites
- Node.js installed on your machine

### Windows One-Click Launch
After downloading or cloning this repository, double-click:
```text
start-sonic-topography.bat
```

The script automatically:
1. Installs dependencies if `node_modules/` is missing
2. Builds the project if `dist/` is missing
3. Opens `http://127.0.0.1:4173`
4. Starts the local production server with NetEase proxy

### Development Mode
```bash
npm install
npm run dev
```
Then open:
```text
http://127.0.0.1:3000
```

### Production Mode
```bash
npm install
npm run build
npm start
```
Then open:
```text
http://127.0.0.1:4173
```

## 🎵 Demo Files

Built-in demo files are located at:
```text
public/demo.mp3
public/demo.lrc
```

To replace the demo, keep these filenames unchanged.

## 📦 Sharing with Others

The recipient can download the GitHub repository ZIP, extract it, and double-click:
```text
start-sonic-topography.bat
```

> **Note:** This is not a standalone `.exe`. The recipient still needs Node.js installed.

## 🎯 Onboarding Tutorial

First-time visitors are greeted with a 5-step interactive tutorial covering:
1. Welcome & overview of audio-reactive visualization
2. How to start the built-in demo
3. Playing your own music files (drag & drop)
4. Searching NetEase Cloud Music
5. Interacting with the 3D terrain

The tutorial only appears once and is remembered via localStorage.

## ⚠️ Notes

- The NetEase Cloud Music feature uses an unofficial web API, proxied through the local server. Search results try to show only currently playable songs, but playability may change due to copyright, membership, regional, or login restrictions.
- Playlists are primarily saved to the local file `data/playlists.json`. As long as you keep the project folder, your playlists persist; browser `localStorage` serves as a fallback.
- `start-sonic-topography.bat` starts a local service at `http://127.0.0.1:4173` by default.

## 🛠️ Commands

```bash
npm run lint      # TypeScript type check
npm run build     # Build for production
npm start         # Start production server
```

## 🔗 Original Project

This project is forked from the original **Sonic Topography** by [yin-yizhen](https://github.com/yin-yizhen):

👉 [https://github.com/yin-yizhen/sonic-topography](https://github.com/yin-yizhen/sonic-topography)

Full credit for the core visualization engine, audio analysis, and original design goes to the original author.

---

*Made with 🎵 and Three.js*
