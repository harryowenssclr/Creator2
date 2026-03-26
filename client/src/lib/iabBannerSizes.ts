export interface IabBannerSize {
  w: number
  h: number
  label: string
}

export function iabSizeKey(s: IabBannerSize): string {
  return `${s.w}x${s.h}`
}

/** Default placements when the asset loads (user can add more below). */
export const IAB_DEFAULT_SIZES: IabBannerSize[] = [
  { w: 300, h: 600, label: 'Half Page' },
  { w: 300, h: 250, label: 'Medium Rectangle' },
]

const defaultKeys = new Set(IAB_DEFAULT_SIZES.map(iabSizeKey))

/** Additional IAB sizes the user can opt into (checkboxes). */
export const IAB_OPTIONAL_EXTRA_SIZES: IabBannerSize[] = [
  { w: 336, h: 280, label: 'Large Rectangle' },
  { w: 728, h: 90, label: 'Leaderboard' },
  { w: 970, h: 250, label: 'Billboard' },
  { w: 970, h: 90, label: 'Super Leaderboard' },
  { w: 320, h: 50, label: 'Mobile Banner' },
  { w: 320, h: 100, label: 'Large Mobile Banner' },
  { w: 160, h: 600, label: 'Wide Skyscraper' },
  { w: 120, h: 600, label: 'Skyscraper' },
  { w: 468, h: 60, label: 'Full Banner' },
  { w: 250, h: 250, label: 'Square' },
  { w: 200, h: 200, label: 'Small Square' },
  { w: 320, h: 480, label: 'Mobile Large' },
  { w: 300, h: 1050, label: 'Portrait' },
].filter((s) => !defaultKeys.has(iabSizeKey(s)))

/** Full catalog (defaults + optional extras), deduped by key. */
export const IAB_ALL_SIZES: IabBannerSize[] = [...IAB_DEFAULT_SIZES, ...IAB_OPTIONAL_EXTRA_SIZES]
