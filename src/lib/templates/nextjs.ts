import type { FrameworkTemplate } from './index';

export const nextjsTemplate: FrameworkTemplate = {
  id: 'nextjs',
  name: 'Next.js',
  icon: '▲',
  description: 'Next.js with App Router and Tailwind CSS',
  files: {
    '/package.json': JSON.stringify({
      name: 'brainhalf-app',
      private: true,
      version: '0.0.0',
      scripts: {
        dev: 'next dev --turbopack',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        tailwindcss: '^3.4.1',
        postcss: '^8.4.35',
        autoprefixer: '^10.4.17',
      },
    }, null, 2),
    '/next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {}
export default nextConfig
`,
    '/tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
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
    '/app/layout.jsx': `import './globals.css'

export const metadata = {
  title: 'App',
  description: 'Built with BrainHalf',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
    '/app/page.jsx': `export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">Hello World</h1>
        <p className="mt-2 text-gray-600">Start building your Next.js app</p>
      </div>
    </main>
  )
}
`,
    '/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  },
};
