/**
 * Encode social / reel video for CM360 HTML5 zips (~9.5 MB asset budget; zip also includes index.html).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveFfmpegBinary, resolveFfprobeBinary } from './ffmpegResolve.js'

const execFileAsync = promisify(execFile)

/** Match CM360 trafficking “under 10 MB” practice: keep MP4 under ~9.5 MB so zip stays safe. */
export const CM360_VIDEO_MAX_BYTES = Math.floor(9.5 * 1024 * 1024)

const AUDIO_BPS = 96_000
/** Leave headroom for MP4 container + audio vs target. */
const BUDGET_FUDGE = 0.84
const MAX_ENCODE_ATTEMPTS = 8

async function probeDurationSeconds(ffprobe, inPath) {
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inPath,
    ],
    { windowsHide: true, maxBuffer: 1_048_576 },
  )
  const sec = parseFloat(String(stdout).trim())
  return Number.isFinite(sec) && sec > 0.1 ? sec : 10
}

/**
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
export async function transcodeVideoBufferForCm360(inputBuffer) {
  if (!inputBuffer || inputBuffer.length < 256) {
    throw new Error('Invalid video input (too small)')
  }

  if (inputBuffer.length <= CM360_VIDEO_MAX_BYTES) {
    return Buffer.from(inputBuffer)
  }

  const ffmpeg = resolveFfmpegBinary()
  const ffprobe = resolveFfprobeBinary()
  if (!ffmpeg || !ffprobe) {
    throw new Error('ffmpeg and ffprobe are required to compress video for CM360. Set FFMPEG_PATH in server/.env.')
  }

  const dir = await mkdtemp(join(tmpdir(), 'cm360-vid-'))
  const inPath = join(dir, 'in.mp4')
  const outPath = join(dir, 'out.mp4')

  try {
    await writeFile(inPath, inputBuffer)
    const duration = await probeDurationSeconds(ffprobe, inPath)

    let longSide = 1080
    let bpsScale = 1

    for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt++) {
      const videoBps = Math.max(
        45_000,
        Math.floor(
          ((CM360_VIDEO_MAX_BYTES * 8 * BUDGET_FUDGE) / duration - AUDIO_BPS) * bpsScale,
        ),
      )

      const vf = `scale=if(gt(iw,ih),min(${longSide},iw),-2):if(gt(iw,ih),-2,min(${longSide},ih))`

      const args = [
        '-y',
        '-i',
        inPath,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        String(videoBps),
        '-maxrate',
        String(Math.floor(videoBps * 1.28)),
        '-bufsize',
        String(Math.floor(videoBps * 2)),
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        outPath,
      ]

      await execFileAsync(ffmpeg, args, {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })

      const st = await stat(outPath)
      if (st.size > 0 && st.size <= CM360_VIDEO_MAX_BYTES) {
        return await readFile(outPath)
      }

      bpsScale *= 0.72
      longSide = Math.max(480, Math.floor(longSide * 0.86))
    }

    throw new Error(
      `Could not compress video under CM360 budget (${(CM360_VIDEO_MAX_BYTES / 1024 / 1024).toFixed(2)} MB). Try a shorter clip.`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
