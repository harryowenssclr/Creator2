/**
 * Apify integration for Instagram media extraction.
 * Uses igview-owner/instagram-video-downloader (~$5/1000 results).
 * Returns direct download URLs for videos and photos.
 */

import axios from 'axios'

const INSTAGRAM_ACTOR = 'igview-owner~instagram-video-downloader'
const APIFY_BASE = 'https://api.apify.com/v2'

async function apifyFetchInstagram(url) {
  const token = process.env.APIFY_TOKEN
  if (!token || !token.trim()) {
    return null
  }

  const instagramUrl = url.trim()
  if (!/instagram\.com/.test(instagramUrl)) {
    return null
  }

  try {
    // 1. Start the actor run (with waitForFinish so we get result in one round-trip)
    const { data: runData, status: runStatus } = await axios.post(
      `${APIFY_BASE}/acts/${INSTAGRAM_ACTOR}/runs`,
      { instagram_urls: [instagramUrl] },
      {
        params: { token, waitForFinish: 120 },
        headers: { 'Content-Type': 'application/json' },
        timeout: 130000,
        validateStatus: () => true,
      }
    )

    if (runStatus >= 400) {
      console.warn('Apify run error:', runStatus, runData)
      return null
    }

    const run = runData.data || runData
    const status = run.status
    const datasetId = run.defaultDatasetId

    if (status !== 'SUCCEEDED') {
      console.warn('Apify run status:', status)
      return null
    }

    if (!datasetId) {
      console.warn('Apify: no datasetId in run response')
      return null
    }

    // 2. Fetch dataset items
    const { data: raw, status: itemsStatus } = await axios.get(
      `${APIFY_BASE}/datasets/${datasetId}/items`,
      {
        params: { token },
        timeout: 15000,
        validateStatus: () => true,
      }
    )

    if (itemsStatus >= 400) {
      console.warn('Apify dataset error:', itemsStatus)
      return null
    }
    const items = Array.isArray(raw) ? raw : raw?.data?.items ?? raw?.items ?? []
    const first = items[0]

    if (!first) {
      return null
    }

    const downloadUrl = first.download_url
    const mediaType = first.media_type === 'video' ? 'video' : 'image'

    if (!downloadUrl) {
      return null
    }

    return {
      mediaUrl: downloadUrl,
      mediaType,
    }
  } catch (err) {
    console.warn('Apify fetch error:', err.message)
    return null
  }
}

export { apifyFetchInstagram }
