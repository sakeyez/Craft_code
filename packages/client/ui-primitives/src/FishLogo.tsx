// CraftCode project mark. The Web app serves the transparent color artwork
// from its favicon URL so install metadata and in-app branding share one asset.

import type { IconProps } from './icons/props.ts'

/**
 * Render the CraftCode project mark.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement and host-owned motion.
 * @returns the decorative logo image (aria-hidden; pair with visible brand text).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      width={size}
      height={size}
      className={className}
      src="/favicon.svg"
      alt=""
      aria-hidden="true"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}
