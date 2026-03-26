import './loadEnv.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import { resolveYtDlpBinary } from './lib/ytDlpResolve.js'
import { resolveFfmpegBinary } from './lib/ffmpegResolve.js'
import { socialRouter } from './routes/social.js'
import { websiteRouter } from './routes/website.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

/** Built SPA — same origin as API in production (Railway, etc.). */
const clientDist = path.join(__dirname, '..', 'client', 'dist')
const serveSpa = fs.existsSync(path.join(clientDist, 'index.html'))

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.use('/api/social', socialRouter)
app.use('/api/website', websiteRouter)

if (serveSpa) {
  app.use(express.static(clientDist, { index: false }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  const ytdlp = resolveYtDlpBinary()
  const ffmpeg = resolveFfmpegBinary()
  console.log(`Server running at http://localhost:${PORT}${serveSpa ? ' (serving client/dist)' : ' (API only — run "cd client && npm run build" for SPA)'}`)
  if (ytdlp) {
    console.log(`yt-dlp OK (${ytdlp})`)
  } else {
    console.warn(
      'yt-dlp not found — Social Post Extractor /fetch will miss TikTok/Facebook and many reels. Install yt-dlp or set YT_DLP_PATH in server/.env',
    )
  }
  if (ffmpeg) {
    console.log(`ffmpeg OK (${ffmpeg})`)
  } else {
    console.warn(
      'ffmpeg not found — yt-dlp may fail on merged video (Instagram/TikTok). Set FFMPEG_PATH in server/.env or install ffmpeg.',
    )
  }
})
