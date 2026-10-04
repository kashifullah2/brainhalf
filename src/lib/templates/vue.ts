import type { FrameworkTemplate } from './index';

export const vueTemplate: FrameworkTemplate = {
  id: 'vue',
  name: 'Vue',
  icon: '💚',
  description: 'Vue 3 + Vite with Tailwind CSS',
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
        vue: '^3.4.0',
        'vue-router': '^4.3.0',
      },
      devDependencies: {
        '@vitejs/plugin-vue': '^5.0.0',
        vite: '^5.4.0',
        tailwindcss: '^3.4.1',
        postcss: '^8.4.35',
        autoprefixer: '^10.4.17',
      },
    }, null, 2),
    '/vite.config.js': `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
})
`,
    '/tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
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
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
    '/src/main.js': `import { createApp } from 'vue'
import App from './App.vue'
import './index.css'

createApp(App).mount('#app')
`,
    '/src/App.vue': `<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-4xl font-bold text-gray-900">Hello World</h1>
      <p class="mt-2 text-gray-600">Start building your Vue app</p>
    </div>
  </div>
</template>

<script setup>
</script>
`,
    '/src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  },
};
