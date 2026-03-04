import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })
import express from 'express'
import cors from 'cors'
import { socialRouter } from './routes/social.js'
import { websiteRouter } from './routes/website.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.use('/api/social', socialRouter)
app.use('/api/website', websiteRouter)

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
