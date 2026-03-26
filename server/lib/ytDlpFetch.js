/**
 * Download media from a public post URL using yt-dlp (must be installed separately).
 * Uses a temp file (not stdout): Instagram/TikTok often need merged video+audio via ffmpeg,
 * which does not work with -o -.
 *
 * Env:
 *   YT_DLP_PATH — optional explicit executable
 *   YT_DLP_COOKIES — optional Netscape cookies.txt (helps IG/FB)
 *   FFMPEG_PATH — optional; passed as --ffmpeg-location (needed for merged formats)
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ffmpegLocationArgs } from './ffmpegResolve.js'
import { getYtDlpCommandOrNull } from './ytDlpResolve.js'

const execFileP = promisify(execFile)
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

function looksLikeWebp(buf) {
  return (
    buf &&
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
}

/**
 * Instagram often serves a login wall on the main reel URL but embed works better
 * for extractors. yt-dlp can succeed on /embed/ when the share URL fails.
 */
export function buildYtDlpUrlCandidates(url) {
  const raw = (url || '').trim()
  if (!raw) return []
  const list = []
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const noQuery = `${u.origin}${u.pathname}`.replace(/\/+$/, '') || u.origin
    list.push(noQuery)
    if (host.includes('instagram.com')) {
      const path = u.pathname.replace(/\/+$/, '') || '/'
      const m = path.match(/^\/(reel|p|tv)\/([^/#?]+)/i)
      if (m) {
        const kind = m[1].toLowerCase()
        const id = m[2]
        const clean = `${u.origin}/${kind}/${id}/`
        const embed = `${u.origin}/${kind}/${id}/embed/`
        list.push(clean, embed)
      }
    }
    return [...new Set(list)]
  } catch {
    return [raw]
  }
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

async function largestFileInDir(dir) {
  const names = await readdir(dir)
  let bestPath = null
  let bestSize = 0
  for (const n of names) {
    const p = join(dir, n)
    const st = await stat(p)
    if (st.isFile() && st.size > bestSize) {
      bestSize = st.size
      bestPath = p
    }
  }
  return bestPath && bestSize ? { path: bestPath, size: bestSize } : null
}

async function emptyDir(dir) {
  const names = await readdir(dir).catch(() => [])
  for (const n of names) {
    await rm(join(dir, n), { force: true }).catch(() => {})
  }
}

function classifyBuffer(buffer) {
  if (looksLikeMp4(buffer)) {
    return { contentType: 'video/mp4', mediaType: 'video' }
  }
  if (looksLikeJpeg(buffer)) {
    return { contentType: 'image/jpeg', mediaType: 'image' }
  }
  if (looksLikePng(buffer)) {
    return { contentType: 'image/png', mediaType: 'image' }
  }
  if (looksLikeWebp(buffer)) {
    return { contentType: 'image/webp', mediaType: 'image' }
  }
  if (buffer.length > 20_000) {
    return { contentType: 'video/mp4', mediaType: 'video' }
  }
  return null
}

/**
 * @returns {Promise<{ ok: boolean, buffer?: Buffer, contentType?: string, mediaType?: string, error?: string, stderrTail?: string }>}
 */
export async function ytDlpFetch(url) {
  const bin = getYtDlpCommandOrNull()
  const cookies = (process.env.YT_DLP_COOKIES || '').trim()

  if (!bin) {
    return {
      ok: false,
      error:
        'yt-dlp not found. Install from https://github.com/yt-dlp/yt-dlp/releases or set YT_DLP_PATH (see server/.env.example).',
    }
  }

  const pageCandidates = buildYtDlpUrlCandidates(url)
  const targets = pageCandidates.length ? pageCandidates : [url.trim()]

  let dir
  try {
    dir = await mkdtemp(join(tmpdir(), 'creator-ytdlp-'))
  } catch (err) {
    return { ok: false, error: `Could not create temp dir: ${err.message}` }
  }

  const outTmpl = join(dir, 'media.%(ext)s')
  let stderrAll = ''
  const ff = ffmpegLocationArgs()

  const attempts = [
    {
      label: 'merge-mp4',
      args: [
        ...(cookies ? ['--cookies', cookies] : []),
        ...ff,
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '-f',
        'bv*+ba/bestvideo+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '-o',
        outTmpl,
        '__URL__',
      ],
    },
    {
      label: 'best-single',
      args: [
        ...(cookies ? ['--cookies', cookies] : []),
        ...ff,
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '-f',
        'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best',
        '-o',
        outTmpl,
        '__URL__',
      ],
    },
    {
      label: 'best-any',
      args: [
        ...(cookies ? ['--cookies', cookies] : []),
        ...ff,
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '-f',
        'best',
        '-o',
        outTmpl,
        '__URL__',
      ],
    },
  ]

  try {
    for (const pageUrl of targets) {
      stderrAll += `\n--- page: ${pageUrl.slice(0, 120)} ---\n`
      for (const { label, args: argsTemplate } of attempts) {
        const args = argsTemplate.map((x) => (x === '__URL__' ? pageUrl : x))
        try {
          await emptyDir(dir)
        } catch (err) {
          stderrAll += `[${pageUrl}][${label}] emptyDir: ${err.message}\n`
          continue
        }
        try {
          const { stderr } = await execFileP(bin, args, {
            timeout: 180_000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          })
          if (stderr) stderrAll += stderr.slice(-2000)
        } catch (err) {
          const se = err.stderr?.toString() || err.message || String(err)
          stderrAll += `[${label}] ${se}\n`
          continue
        }

        let picked
        try {
          picked = await largestFileInDir(dir)
        } catch (err) {
          stderrAll += `[${label}] list dir: ${err.message}\n`
          continue
        }
        if (!picked || picked.size < 1000) {
          stderrAll += `[${label}] no output file or too small\n`
          continue
        }
        if (picked.size > MAX_BYTES) {
          return {
            ok: false,
            error: `Download exceeded ${MAX_BYTES} bytes cap`,
            stderrTail: stderrAll.slice(-600),
          }
        }

        let buffer
        try {
          buffer = await readFile(picked.path)
        } catch (err) {
          stderrAll += `[${label}] readFile: ${err.message}\n`
          continue
        }
        const kind = classifyBuffer(buffer)
        if (!kind) {
          stderrAll += `[${label}] output not recognized as video/image\n`
          continue
        }

        return { ok: true, buffer, contentType: kind.contentType, mediaType: kind.mediaType }
      }
    }

    return {
      ok: false,
      error: 'yt-dlp could not download this URL (all format attempts failed)',
      stderrTail: stderrAll.slice(-1200),
    }
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'yt-dlp run failed',
      stderrTail: stderrAll.slice(-800),
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
