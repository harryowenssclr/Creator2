/**
 * Resolve the yt-dlp executable (Windows often needs yt-dlp.exe on PATH).
 */

import { spawnSync } from 'child_process'

/** @type {string|null|undefined} undefined = not yet resolved */
let cachedResolved = undefined

function candidatesFromEnv() {
  const custom = (process.env.YT_DLP_PATH || '').trim()
  if (custom) return [custom]
  if (process.platform === 'win32') {
    return ['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp']
  }
  return ['yt-dlp']
}

/**
 * First working executable from env or common names, or null.
 * @returns {string|null}
 */
export function resolveYtDlpBinary() {
  if (cachedResolved !== undefined) return cachedResolved
  for (const bin of candidatesFromEnv()) {
    try {
      const r = spawnSync(bin, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 12_000,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      if (r.status === 0) {
        cachedResolved = bin
        return bin
      }
    } catch {
      /* try next */
    }
  }
  cachedResolved = null
  return null
}

/** @returns {Promise<boolean>} */
export function isYtDlpAvailable() {
  return Promise.resolve(resolveYtDlpBinary() !== null)
}

/** Command string for spawn, or null if none found (after probe). */
export function getYtDlpCommandOrNull() {
  return resolveYtDlpBinary()
}
