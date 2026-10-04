import type { FrameworkTemplate } from './index';

export const svelteTemplate: FrameworkTemplate = {
  id: 'svelte',
  name: 'Svelte',
  icon: '🔥',
  description: 'SvelteKit with Tailwind CSS',
  files: {
    '/package.json': JSON.stringify({
      name: 'brainhalf-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite dev',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {},
      devDependencies: {
        '@sveltejs/kit': '^2.5.0',
        '@sveltejs/adapter-auto': '^3.1.0',
        '@sveltejs/vite-plugin-svelte': '^3.0.0',
        svelte: '^4.2.0',
        vite: '^5.4.0',
        tailwindcss: '^3.4.1',
        postcss: '^8.4.35',
        autoprefixer: '^10.4.17',
      },
    }, null, 2),
    '/vite.config.js': `import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
})
`,
    '/svelte.config.js': `import adapter from '@sveltejs/adapter-auto'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: { adapter: adapter() },
}
export default config
`,
    '/tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
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
    '/src/app.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body>
    <div>%sveltekit.body%</div>
  </body>
</html>
`,
    '/src/app.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    '/src/routes/+layout.svelte': `<script>
  import '../app.css'
</script>

<slot />
`,
    '/src/routes/+page.svelte': `<div class="min-h-screen bg-gray-50 flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-gray-900">Hello World</h1>
    <p class="mt-2 text-gray-600">Start building your Svelte app</p>
  </div>
</div>
`,
  },
};
