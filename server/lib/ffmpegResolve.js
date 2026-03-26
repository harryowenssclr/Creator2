/**
 * Resolve ffmpeg for yt-dlp --ffmpeg-location (merge video+audio).
 * Node/Cursor often starts without the same PATH as your shell.
 *
 * Env: FFMPEG_PATH — full path to ffmpeg.exe (recommended on Windows).
 */

import { execFileSync } from 'child_process'

let cachedResolved = undefined

export function clearFfmpegBinaryCache() {
  cachedResolved = undefined
}

function candidatesFromEnv() {
  const custom = (process.env.FFMPEG_PATH || '').trim()
  if (custom) return [custom]
  if (process.platform === 'win32') {
    return ['ffmpeg.exe', 'ffmpeg']
  }
  return ['ffmpeg']
}

function probeExec(bin) {
  try {
    execFileSync(bin, ['-version'], {
      windowsHide: true,
      timeout: 12_000,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/** @returns {string|null} Path passed to yt-dlp --ffmpeg-location */
export function resolveFfmpegBinary() {
  if (cachedResolved !== undefined) return cachedResolved
  for (const bin of candidatesFromEnv()) {
    if (probeExec(bin)) {
      cachedResolved = bin
      return bin
    }
  }
  cachedResolved = null
  return null
}

/** Extra yt-dlp CLI args (empty if ffmpeg not found). */
export function ffmpegLocationArgs() {
  const p = resolveFfmpegBinary()
  return p ? ['--ffmpeg-location', p] : []
}

export function isFfmpegAvailable() {
  return resolveFfmpegBinary() !== null
}
