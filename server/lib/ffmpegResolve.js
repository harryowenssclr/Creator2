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

let cachedFfprobe = undefined

export function clearFfprobeBinaryCache() {
  cachedFfprobe = undefined
}

/** @returns {string|null} ffprobe next to ffmpeg (required for CM360 transcode duration probe). */
export function resolveFfprobeBinary() {
  if (cachedFfprobe !== undefined) return cachedFfprobe
  const ffmpeg = resolveFfmpegBinary()
  if (!ffmpeg) {
    cachedFfprobe = null
    return null
  }
  const candidates = []
  if (/ffmpeg\.exe$/i.test(ffmpeg)) {
    candidates.push(ffmpeg.replace(/ffmpeg\.exe$/i, 'ffprobe.exe'))
  } else if (/[\\/]ffmpeg$/i.test(ffmpeg) || /ffmpeg$/i.test(ffmpeg)) {
    candidates.push(ffmpeg.replace(/ffmpeg$/i, 'ffprobe'))
  } else {
    candidates.push(ffmpeg.replace(/ffmpeg/i, 'ffprobe'))
  }
  for (const bin of candidates) {
    if (probeExec(bin)) {
      cachedFfprobe = bin
      return bin
    }
  }
  cachedFfprobe = null
  return null
}

export function isFfprobeAvailable() {
  return resolveFfprobeBinary() !== null
}
