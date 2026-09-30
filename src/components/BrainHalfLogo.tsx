import React from 'react';

export interface BrainHalfLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
  glow?: boolean;
}

/**
 * The supplied BrainHalf logo, rendered in a stable SVG sizing wrapper across:
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
      viewBox="0 0 512 512"
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
      {/* 128px raster: the logo never renders larger than 38px, so the 512px
          source (187KB) is unnecessary here. The full-size file remains the
          favicon, the FinalCta backdrop, and the structured-data logo. */}
      <image href="/brainhalf-logo-128.png" width="512" height="512" />
    </svg>
  );
};

export default BrainHalfLogo;
