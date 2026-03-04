# Creator - Display Banner Editor

A web application for creating, converting, and exporting HTML5 display banners for Google Campaign Manager 360.

## Features

- **Manual Editor** – Visual design editor with image/video upload, text, layers, and drag-and-drop
- **Social Generator** – Paste Instagram, Facebook, or TikTok URLs to auto-generate 300×600 and 300×250 banners
- **Website Assets** – Extract images, videos, stylesheets, and fonts from any URL
- **MP4 Converter** – Upload MP4 videos and export as HTML5 video banners

All banners export as CM360-compliant HTML5 ZIP files.

## Setup

```bash
# Install all dependencies
npm run install:all

# Run client and server
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

## Development

- `npm run dev` – Run client and server concurrently
- `npm run dev:client` – Run React dev server only
- `npm run dev:server` – Run Express server only
- `npm run build` – Build client for production

## Project Structure

```
Creator/
├── client/          # React + Vite frontend
├── server/          # Express backend (API proxy, scrape, social fetch)
└── package.json     # Root scripts
```

## Social Generator: Video Extraction

Uses a **self-hosted Puppeteer headless browser** (with stealth plugin) to render Instagram, TikTok, and Facebook pages, then extract `og:video` or video element sources.

**Apify fallback (optional):** For reliable Instagram Reel video extraction when headless returns thumbnails, add `APIFY_TOKEN` to `server/.env`. Uses [igview-owner/instagram-video-downloader](https://apify.com/igview-owner/instagram-video-downloader) (~$5/1000 results). Get your token at [console.apify.com/account#/integrations](https://console.apify.com/account#/integrations).

- **First run** downloads Chromium (~300MB) if not cached
- Set `USE_HEADLESS=false` in `server/.env` to disable and fall back to simple HTTP scrape only
- On minimal Linux (Docker, etc.), you may need: `apt install -y chromium` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

See [docs/SOCIAL_VIDEO_RESEARCH.md](docs/SOCIAL_VIDEO_RESEARCH.md) for research on how Nova, Spaceback, etc. handle this.

## CM360 Export Requirements

- Max 100 files per ZIP
- Max 10 MB per creative
- Click tag required; no localStorage/sessionStorage
- Video: autoplay muted only
