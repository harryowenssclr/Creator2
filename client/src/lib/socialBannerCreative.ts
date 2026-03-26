export type BannerCrop = { posX: number; posY: number; zoom: number }

export function defaultBannerCrop(): BannerCrop {
  return { posX: 50, posY: 50, zoom: 1 }
}

/** Inline CSS for object-fit cover + focal point + zoom (preview + export). */
export function cropToMediaCss(c: BannerCrop): string {
  const { posX, posY, zoom } = c
  return `object-position:${posX}% ${posY}%;transform:scale(${zoom});transform-origin:${posX}% ${posY}%;`
}

/** Omit crop CSS when unchanged from defaults — matches MP4 Converter markup byte-for-byte. */
export function cropToMediaCssOptional(c: BannerCrop): string {
  if (c.posX === 50 && c.posY === 50 && c.zoom === 1) return ''
  return cropToMediaCss(c)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface OverlayOptions {
  ctaEnabled: boolean
  ctaText: string
  showLike: boolean
  showComment: boolean
  showShare: boolean
}

export function buildBannerOverlayHtml(
  opts: OverlayOptions,
  compat?: { forCm360?: boolean },
): string {
  const { ctaEnabled, ctaText, showLike, showComment, showShare } = opts
  const ascii = compat?.forCm360 === true
  const hasEngagement = showLike || showComment || showShare
  const hasCta = ctaEnabled && ctaText.trim().length > 0
  if (!hasEngagement && !hasCta) return ''

  const iconEmoji = (char: string, label: string) =>
    `<span role="img" aria-label="${escapeHtml(label)}" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:rgba(255,255,255,0.2);font-size:13px;line-height:1;color:#fff;">${char}</span>`

  const iconText = (label: string) =>
    `<span style="display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.22);font-size:10px;line-height:1;font-weight:600;color:#fff;text-transform:uppercase;letter-spacing:0.04em;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</span>`

  const row =
    hasEngagement ?
      `<div style="display:flex;flex-direction:row;gap:8px;align-items:center;justify-content:flex-start;">${
        showLike ? (ascii ? iconText('Like') : iconEmoji('♥', 'Like')) : ''
      }${showComment ? (ascii ? iconText('Comment') : iconEmoji('💬', 'Comment')) : ''}${
        showShare ? (ascii ? iconText('Share') : iconEmoji('↗', 'Share')) : ''
      }</div>`
    : ''

  const cta =
    hasCta ?
      `<div style="align-self:flex-start;"><span style="display:inline-block;padding:8px 14px;border-radius:999px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;">${escapeHtml(ctaText.trim())}</span></div>`
    : ''

  return `<div style="position:absolute;left:0;right:0;bottom:0;pointer-events:none;padding:10px 12px 12px;background:linear-gradient(to top,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0.35) 55%,transparent 100%);display:flex;flex-direction:column;gap:10px;align-items:stretch;z-index:2;">
    ${row}
    ${cta}
  </div>`
}

/**
 * CM360 body: match MP4 Converter DOM — one relative div, video#video1 direct child
 * (Studio / Enabler expects this pattern). Overlay is an optional absolutely positioned sibling.
 */
export function buildCm360CreativeBody(params: {
  treatAsVideo: boolean
  assetName: string
  mediaCss: string
  overlayHtml: string
}): string {
  const { treatAsVideo, assetName, mediaCss, overlayHtml } = params
  const vidOrImg = treatAsVideo ?
      `<video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;${mediaCss}"></video>`
    : `<img src="${assetName}" alt="" style="width:100%;height:100%;object-fit:cover;${mediaCss}" />`

  const overlay = overlayHtml.trim() ? `\n    ${overlayHtml.trim()}` : ''

  return `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    ${vidOrImg}${overlay}
  </div>`
}
