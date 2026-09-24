# Landing page — midnight workspace direction

Implemented locally on September 23, 2026.

BrainHalf helps people turn an app idea into editable software. The page's primary action remains entering a prompt. The signature layout is a connected build desk: a personal brief on the left, selectable example apps on the right, with the original prompt and a working “Use this idea” action beneath each preview.

## Visual direction

- Midnight canvas `#111722`, elevated blue-gray panels `#192230`, inset preview surround `#141e2c`.
- Porcelain text `#edf2fa`, muted blue-gray `#a4b1c4`, soft blue actions `#a8c7f6`.
- Existing local Bricolage, Instrument Sans and DM Mono faces retain the brand identity. Large display type leads into a compact, practical workspace.
- Removed the tilted showcase, dotted backdrop and sketched underline. Straight app frames, an existing Iceland photograph, subtle borders and restrained shadows give the hero structure.
- Updated shared dark-theme tokens, the initial theme script and browser theme-color metadata together. Light mode retains its blue/porcelain palette.
- Refined idea-card accents, workflow surface, closing section, mobile spacing and narrow-screen account navigation. Example contents use intrinsic height to avoid clipping.

## Validation

- Application and runtime typechecks passed.
- 39 existing landing-page, SEO and analytics tests passed.
- Lint passed with the existing `no-control-regex` warning in `src/runtime/uploads.ts:82`.
- Final production build, preview build, prerender and SEO checks passed.
- Sixteen text/button color pairs computed from the theme tokens meet WCAG AA (minimum 4.58:1); see `contrast.json`. This is a token calculation, not a browser-computed accessibility audit.
- Tracked diff whitespace check passed.

Browser verification was prepared in `/tmp/brainhalf-landing-visual-check.mjs` for 1440, 768, 390 and 320 px widths in both themes, screenshots, example tabs, keyboard navigation, prompt handoff and theme switching. Execution required permission to start a local server and Chrome. Automatic approval review failed with HTTP 404 because its API deployment was unavailable. The command did not execute; screenshots and browser behavior are not verified. The approval boundary was not bypassed.

Logs: `/tmp/brainhalf-landing-refresh-{typecheck,tests,lint,final-build}.log`.
