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
