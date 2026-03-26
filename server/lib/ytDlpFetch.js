/**
 * Download media from a public post URL using yt-dlp (must be installed separately).
 * Supports Instagram, TikTok, Facebook, and many other sites with maintained extractors.
 *
 * Env:
 *   YT_DLP_PATH — path to yt-dlp executable (optional; on Windows we also try yt-dlp.exe / .cmd on PATH)
 *   YT_DLP_COOKIES — optional Netscape cookies.txt path (improves IG/FB when logged in)
 */

import { spawn } from 'child_process'
import { getYtDlpCommandOrNull } from './ytDlpResolve.js'

const MAX_BYTES = 50 * 1024 * 1024

function looksLikeMp4(buf) {
  return (
    buf &&
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  )
}

function looksLikeJpeg(buf) {
  return buf && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

function looksLikePng(buf) {
  return (
    buf &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
}

/** Hosts we attempt with yt-dlp after headless / direct URL cache fails. */
export function isYtdlpSupportedUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const u = new URL(url.trim())
    const h = u.hostname.toLowerCase()
    return (
      h.includes('instagram.com') ||
      h.includes('tiktok.com') ||
      h.includes('facebook.com') ||
      h.includes('fb.com') ||
      h.includes('fb.watch')
    )
  } catch {
    return false
  }
}

/**
 * @returns {Promise<{ ok: boolean, buffer?: Buffer, contentType?: string, mediaType?: string, error?: string, stderrTail?: string }>}
 */
export function ytDlpFetch(url) {
  const bin = getYtDlpCommandOrNull()
  const cookies = (process.env.YT_DLP_COOKIES || '').trim()

  return new Promise((resolve) => {
    if (!bin) {
      return resolve({
        ok: false,
        error:
          'yt-dlp not found. Install from https://github.com/yt-dlp/yt-dlp/releases or set YT_DLP_PATH (see server/.env.example).',
      })
    }
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-f',
      'best[ext=mp4]/best[height<=1080]/best',
      '-o',
      '-',
      url.trim(),
    ]
    if (cookies) {
      args.unshift('--cookies', cookies)
    }

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const chunks = []
    let total = 0
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      total += chunk.length
      if (total <= MAX_BYTES) {
        chunks.push(chunk)
      }
    })

    child.stderr.on('data', (d) => {
      const s = d.toString()
      stderr += s
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })

    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }, 120_000)

    child.on('error', (err) => {
      clearTimeout(killTimer)
      resolve({ ok: false, error: err.message })
    })

    child.on('close', (code) => {
      clearTimeout(killTimer)
      if (total > MAX_BYTES) {
        return resolve({
          ok: false,
          error: `yt-dlp output exceeded ${MAX_BYTES} bytes cap`,
          stderrTail: stderr.slice(-500),
        })
      }
      const buffer = Buffer.concat(chunks)
      if (!buffer.length || buffer.length < 1000) {
        return resolve({
          ok: false,
          error: code !== 0 ? `yt-dlp exited ${code}` : 'yt-dlp produced empty output',
          stderrTail: stderr.slice(-500),
        })
      }
      let contentType = 'application/octet-stream'
      let mediaType = 'video'
      if (looksLikeMp4(buffer)) {
        contentType = 'video/mp4'
        mediaType = 'video'
      } else if (looksLikeJpeg(buffer)) {
        contentType = 'image/jpeg'
        mediaType = 'image'
      } else if (looksLikePng(buffer)) {
        contentType = 'image/png'
        mediaType = 'image'
      } else if (buffer.length > 20_000 && code === 0) {
        contentType = 'video/mp4'
        mediaType = 'video'
      } else {
        return resolve({
          ok: false,
          error: 'yt-dlp output does not look like MP4 or image',
          stderrTail: ellipsis(stderr, 400),
        })
      }
      resolve({ ok: true, buffer, contentType, mediaType })
    })
  })
}

function ellipsis(s, n) {
  if (!s || s.length <= n) return s
  return s.slice(0, n) + '…'
}
