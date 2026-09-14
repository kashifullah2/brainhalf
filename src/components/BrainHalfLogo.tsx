import React from 'react';

export interface BrainHalfLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
  glow?: boolean;
}

/**
 * Single consistent BrainHalf SVG Logo Asset used across:
 * - Sidebar brand badge
 * - Chat panel header & AI message avatar
 * - Top navigation bar brand header
 * - Large centered empty-state hero icon
 */
export const BrainHalfLogo: React.FC<BrainHalfLogoProps> = ({
  size = 16,
  strokeWidth = 1.75,
  color = '#2dd4bf',
  glow = false,
  className = '',
  style,
  ...rest
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-brain-circuit brainhalf-logo-svg ${className}`}
      style={{
        flexShrink: 0,
        filter: glow ? 'drop-shadow(0 0 10px rgba(45, 212, 191, 0.65)) drop-shadow(0 0 20px rgba(20, 184, 166, 0.35))' : undefined,
        ...style
      }}
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M9 13a4.5 4.5 0 0 0 3-4" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M12 13h4" />
      <path d="M12 18h6a2 2 0 0 1 2 2v1" />
      <path d="M12 8h8" />
      <path d="M16 8V5a2 2 0 0 1 2-2" />
      <circle cx="16" cy="13" r=".5" />
      <circle cx="18" cy="3" r=".5" />
      <circle cx="20" cy="21" r=".5" />
      <circle cx="20" cy="8" r=".5" />
    </svg>
  );
};

export default BrainHalfLogo;
