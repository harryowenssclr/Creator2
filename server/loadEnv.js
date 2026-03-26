/**
 * Side-effect import: must be the first import in index.js so process.env is
 * populated before route modules load (ESM evaluates imports before index body).
 */
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { clearYtDlpBinaryCache } from './lib/ytDlpResolve.js'
import { clearFfmpegBinaryCache } from './lib/ffmpegResolve.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })
clearYtDlpBinaryCache()
clearFfmpegBinaryCache()
