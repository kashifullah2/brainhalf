import type { FrameworkTemplate } from './index';

export const vanillaTemplate: FrameworkTemplate = {
  id: 'vanilla',
  name: 'Vanilla',
  icon: '📦',
  description: 'Plain HTML/CSS/JS with Vite',
  files: {
    '/package.json': JSON.stringify({
      name: 'brainhalf-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      devDependencies: {
        vite: '^5.4.0',
      },
    }, null, 2),
    '/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div id="app">
      <h1>Hello World</h1>
      <p>Start building your app</p>
    </div>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`,
    '/main.js': `import './style.css'

console.log('App loaded')
`,
    '/style.css': `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f9fafb;
  color: #111827;
}

#app {
  text-align: center;
}

h1 {
  font-size: 2.25rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

p {
  color: #6b7280;
}
`,
  },
};
