/**
 * Resolve the yt-dlp executable (Windows often needs yt-dlp.exe on PATH).
 */

import { execFileSync } from 'child_process'

/** @type {string|null|undefined} undefined = not yet resolved */
let cachedResolved = undefined

/** Call after dotenv.config so a probe can run again with fresh env. */
export function clearYtDlpBinaryCache() {
  cachedResolved = undefined
}

function candidatesFromEnv() {
  const custom = (process.env.YT_DLP_PATH || '').trim()
  if (custom) return [custom]
  if (process.platform === 'win32') {
    return ['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp']
  }
  return ['yt-dlp']
}

function probeExec(bin) {
  try {
    execFileSync(bin, ['--version'], {
      windowsHide: true,
      timeout: 15_000,
      stdio: 'ignore',
    })
    return true
  } catch (err) {
    if (process.env.SOCIAL_FETCH_DEBUG === '1' || process.env.SOCIAL_FETCH_DEBUG === 'true') {
      console.warn(`[yt-dlp] probe failed for "${bin}":`, err.message)
    }
    return false
  }
}

/**
 * First working executable from env or common names, or null.
 * @returns {string|null}
 */
export function resolveYtDlpBinary() {
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

/**
 * Fresh probe for GET /config — avoids a stale “not found” after installing yt-dlp
 * or fixing .env without restarting (we still recommend restart).
 */
export function isYtDlpAvailable() {
  clearYtDlpBinaryCache()
  return Promise.resolve(resolveYtDlpBinary() !== null)
}

/** Command string for spawn, or null if none found (after probe). */
export function getYtDlpCommandOrNull() {
  return resolveYtDlpBinary()
}
