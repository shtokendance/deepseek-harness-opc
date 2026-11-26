import type { IconProps } from './icons/props.ts'

export const FISH_LOGO_VIEWBOX = { width: 24, height: 24 }

export const FISH_LOGO_PATH = 'M11.6 7.4H14.5L12.7 15.2H14.2L13.8 16.9H9.5L9.9 15.2H11.1L12.3 9.4H11.1L11.6 7.4Z'

export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.2" stroke="#0066FF" strokeWidth="3.2" strokeDasharray="8.1 11.16" strokeDashoffset="-1.1" transform="rotate(-118 12 12)" />
      <circle cx="12" cy="12" r="9.2" stroke="#7EB6FF" strokeWidth="3.2" strokeDasharray="8.1 11.16" strokeDashoffset="-10.73" transform="rotate(-118 12 12)" />
      <path d={FISH_LOGO_PATH} fill="#0066FF" />
    </svg>
  )
}
