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

## CM360 Export Requirements

- Max 100 files per ZIP
- Max 10 MB per creative
- Click tag required; no localStorage/sessionStorage
- Video: autoplay muted only
