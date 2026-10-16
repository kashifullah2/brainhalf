# BrainHalf Design Tokens

## PART 1 — Compact Token Summary

### Brand / Accent
| Token | Light Value | Dark Value |
|---|---|---|
| `--accent-primary` | `#5857FF` | `#7B7AFF` |
| `--accent-secondary` | `#3A39C0` | `#9B9AFF` |
| `--accent-light` | `#8887FF` | `#8887FF` |
| `--brand-solid` | `#5857FF` | `#7B7AFF` |
| `--brand-solid-hover` | `#3A39C0` | `#9B9AFF` |
| `--brand-on-solid` | `#ffffff` | `#ffffff` |
| `--focus-ring` | `rgba(88,87,255,0.15)` | `rgba(88,87,255,0.18)` |

### Backgrounds
| Token | Light | Dark |
|---|---|---|
| `--bg-canvas` / `--studio-paper` | `#f8f9fc` | `#0C0C0E` |
| `--bg-surface` | `#f4f5f9` | `#171719` |
| `--bg-surface-hover` | `#edf0f8` | `#1E1E21` |
| `--bg-card` | `#ffffff` | `#171719` |
| `--bg-topnav` | `#ffffff` | `#111113` |
| `--studio-white` | `#ffffff` | `#171719` |

### Text
| Token | Light | Dark |
|---|---|---|
| `--text-primary` / `--studio-ink` | `#202631` | `#EAEAEE` |
| `--text-secondary` | `#4c5568` | `#9494A4` |
| `--text-muted` / `--studio-muted` | `#626d80` | `#5A5A6E` |

### Borders
| Token | Light | Dark |
|---|---|---|
| `--border-subtle` | `#e7eaf1` | `rgba(255,255,255,0.06)` |
| `--border-medium` | `#c7cddb` | `rgba(255,255,255,0.10)` |
| `--border-strong` | `#aab4c6` | `rgba(255,255,255,0.16)` |
| `--border-accent` | `rgba(88,87,255,0.25)` | `rgba(88,87,255,0.30)` |
| `--studio-line` | `#e0e4ed` | `#1E1E21` |

### Semantic Colors
| Token | Value |
|---|---|
| `--color-success` | `#114a2f` |
| `--color-success-bg` | `#edf8f1` |
| `--color-error` | `#7d1828` |
| `--color-error-bg` | `#fff0f2` |
| `--color-warning` | `#543b0c` |
| `--color-warning-bg` | `#fff7e6` |

### Typography
| Token | Value |
|---|---|
| `--font-sans` / `--font-brand` | `'Instrument Studio', Arial, sans-serif` (Instrument Sans) |
| `--font-mono` | `'DM Studio Mono', Consolas, monospace` |

### Shadows
| Token | Value |
|---|---|
| `--shadow-subtle` | `0 2px 5px #1b244008` |
| `--shadow-panel` | `0 4px 18px #1b244006` |
| `--shadow-overlay` | `0 20px 70px #1b24401f` |

### Landing-specific Tokens (light mode only, in .landing-container scope)
| Token | Value |
|---|---|
| `--landing-bg` | `#FAF8F5` (warm white) |
| `--landing-surface` | `#FFFFFF` |
| `--landing-accent` | `#5857FF` |
| `--landing-border` | `#E8E4DF` |
| `--landing-text-4xl` | `clamp(40px, 4.8vw, 62px)` |
| `--landing-text-3xl` | `clamp(34px, 3.6vw, 48px)` |
| `--landing-font-display` | `var(--font-sans)` |

### Spacing Scale (8px grid)
`4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px, 96px, 112px, 128px`
Section padding: `clamp(64px, 8vw, 120px)`

### Radii
`8px, 10px, 12px, 16px, 20px, 999px (pill)`

---

## PART 2 — Raw Source

### studio-theme.css (light mode :root)
```css
:root {
  --accent-primary: #5857FF;
  --accent-secondary: #3A39C0;
  --brand-solid: #5857FF;
  --brand-solid-hover: #3A39C0;
  --brand-on-solid: #ffffff;
  --studio-paper: #f8f9fc;
  --studio-white: #ffffff;
  --studio-ink: #202631;
  --studio-blue: #5857FF;
  --studio-muted: #626d80;
  --studio-line: #e0e4ed;
  --studio-wash: #edf0f8;
  --font-sans: 'Instrument Studio', Arial, sans-serif;
  --font-brand: 'Instrument Studio', Arial, sans-serif;
  --font-mono: 'DM Studio Mono', Consolas, monospace;
}
:root[data-theme='dark'] {
  --studio-paper: #0C0C0E;
  --studio-white: #171719;
  --studio-ink: #EAEAEE;
  --studio-blue: #7B7AFF;
  --studio-muted: #9494A4;
  --studio-line: #1E1E21;
  --brand-solid: #7B7AFF;
  --brand-solid-hover: #9B9AFF;
}
```

### landing-tokens.css (landing-specific, light)
```css
.landing-container {
  --landing-bg: #FAF8F5;
  --landing-accent: #5857FF;
  --landing-ink: #0F0F10;
  --landing-ink-secondary: #4A4A4D;
  --landing-ink-muted: #7C7C80;
  --landing-border: #E8E4DF;
  --landing-font-display: var(--font-sans);
}
```
