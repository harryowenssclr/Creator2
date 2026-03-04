# How Nova, Spaceback, SeenThis Extract Social Video for Display Ads

## Summary

Commercial platforms (Nova, Spaceback, SeenThis, NEXD, Somplo) convert social posts into display ads using **third-party scraping APIs** and **official platform APIs** — not simple HTTP scraping of og: meta tags. Instagram/Facebook serve minimal HTML and load content via JavaScript; og:video often isn't present in the initial response.

---

## Approaches Used by Commercial Platforms

### 1. Third-Party Scraping APIs (Primary)

**Apify** and similar services run headless browsers (Puppeteer/Playwright) in the cloud with:
- Anti-detection (stealth modes, residential proxies)
- Retry logic and rate limiting
- Direct CDN video URL extraction

| Platform   | Apify Actor                                      | Output              | Cost           |
|------------|---------------------------------------------------|---------------------|----------------|
| Instagram  | `igview-owner/instagram-video-downloader`         | `download_url` (MP4)| $5 / 1,000     |
| TikTok     | `clockworks/tiktok-scraper`, `apidojo/tiktok-scraper` | Video URLs        | ~$0.30 / 1,000 |
| Facebook   | `apify/facebook-posts-scraper`                    | Videos, images      | $24.99/mo + use|

**Example (Instagram Media Downloader):**
- Input: `https://www.instagram.com/kyliejenner/reel/DRP7Cajkpn9/`
- Output: `download_url: "https://scontent-lga3-1.cdninstagram.com/..."` (direct MP4)
- ~2–4 seconds per post, no login required for public posts

### 2. Official Platform APIs

**Meta Graph API** (Instagram Business accounts):
- Requires OAuth, app setup, and Meta App Review
- Returns `media_url` for videos
- Only works for **connected business accounts** — not arbitrary public posts

### 3. Headless Browser (Self-Hosted)

- Puppeteer/Playwright can render JS-heavy pages and extract og:video or intercept network requests
- Social platforms use anti-bot measures; requires stealth plugins, proxy rotation
- High maintenance; often blocked

---

## Recommendations for Creator

| Approach             | Reliability | Cost              | Effort |
|----------------------|-------------|-------------------|--------|
| **Puppeteer headless** | Medium–High | Free (self-host)  | Medium |
| Apify integration    | High        | ~$5/1000 uses     | Low    |
| Meta Graph API       | High        | Free (quota)      | High (OAuth, approval) |
| og: meta scrape      | Low (IG/FB) | Free              | Done   |

**Implementer's choice:** Creator uses a self-hosted Puppeteer instance with the stealth plugin. It renders the page, waits for JS, and extracts `og:video`, `<video src>`, or intercepts media network requests. No Apify required. Set `USE_HEADLESS=false` to fall back to simple HTTP scrape only.

---

## References

- [Apify Instagram Media Downloader](https://apify.com/igview-owner/instagram-video-downloader) — direct video URLs, no login
- [Meta Graph API - IG Media](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/) — `media_url` for business accounts
- [Spaceback Social Display](https://www.spaceback.com/social-display)
- [Nova Social Import](https://createwithnova.wiki/nova-socialimport)
- [NEXD Social to Display](https://www.nexd.com/layouts/social-to-display/)
