import type { IconProps } from './icons/props.ts'
import { FishLogo } from './FishLogo.tsx'

export interface BrandWordmarkProps extends IconProps {
  includeMark?: boolean | undefined
}

export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const fontSize = Math.round(size * 0.68)
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.max(6, Math.round(size * 0.28)),
        height: size,
        lineHeight: 1,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: 700,
        fontSize,
        letterSpacing: '-0.02em',
        color: 'currentColor',
        whiteSpace: 'nowrap',
      }}
    >
      {includeMark && <FishLogo size={size} />}
      <span>Work<span style={{ color: '#0066FF' }}>OPC</span></span>
    </span>
  )
}
