export const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BrainHalf Game</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; background: #0a0a0f; color: #e8e8ec; }
      #game-root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="game-root"></div>
    <script type="module" src="/src/game.js"></script>
  </body>
</html>`;

export const DEFAULT_GAME_JS = `const root = document.getElementById('game-root');
if (root) {
  root.innerHTML = \`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:system-ui,sans-serif;text-align:center;padding:1.5rem;">
      <p style="font-size:1.125rem;margin:0;color:#c8c8d0;">Preview ready</p>
      <p style="font-size:0.875rem;margin:0.75rem 0 0;color:#6b6b78;max-width:20rem;line-height:1.5;">
        Describe your game in the agent chat to generate it here.
      </p>
    </div>\`;
}
console.log('[BrainHalf] Entry loaded — src/game.js');
`;

export const DEFAULT_PACKAGE_JSON = JSON.stringify(
  {
    name: 'brainhalf-project',
    type: 'module',
    scripts: {
      start: 'vite',
      build: 'vite build',
    },
    dependencies: {
      vite: '^5.4.11',
    },
  },
  null,
  2,
);
