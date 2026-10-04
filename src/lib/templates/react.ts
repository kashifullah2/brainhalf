import type { FrameworkTemplate } from './index';

export const reactTemplate: FrameworkTemplate = {
  id: 'react',
  name: 'React',
  icon: '⚛️',
  description: 'React + Vite with Tailwind CSS',
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
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.344.0',
        'react-router-dom': '^6.22.3',
      },
      devDependencies: {
        '@vitejs/plugin-react': '^4.2.1',
        vite: '^5.4.0',
        tailwindcss: '^3.4.1',
        postcss: '^8.4.35',
        autoprefixer: '^10.4.17',
      },
    }, null, 2),
    '/vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
    '/tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
`,
    '/postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
    '/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    '/src/main.jsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
    '/src/App.jsx': `export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">Hello World</h1>
        <p className="mt-2 text-gray-600">Start building your app</p>
      </div>
    </div>
  )
}
`,
    '/src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  },
};
