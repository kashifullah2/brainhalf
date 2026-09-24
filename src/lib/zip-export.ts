import JSZip from 'jszip';
import { prepareProjectExport } from './project-export';
import { basicReactTemplate } from './templates';
import { normalizePath, isSafeFilePath } from './utils';
import { relativeProjectImport, selectAppEntry } from './preview-entry';

export async function generateProjectZipBlob(files: Record<string, string>, projectName: string = 'brainhalf-project') {
  const zip = new JSZip();
  files = prepareProjectExport(files).files;
  files = Object.fromEntries(Object.entries(files)
    .filter(([path, content]) => isSafeFilePath(path) && typeof content === 'string')
    .map(([path, content]) => [normalizePath(path), content]));
  const isFullStack = Object.keys(files).some(path => /^\/server(?:\/|\.(?:js|ts|mjs|cjs)$)/.test(path));
  const appEntry = selectAppEntry(files);
  const existingMain = Object.keys(files).find(path => /^\/(?:src\/)?(?:main|index)\.[jt]sx?$/.test(path));
  const mainEntry = existingMain || (appEntry ? '/src/main.jsx' : null);
  const isReactProject = Boolean(appEntry || (existingMain && (/\.[jt]sx$/.test(existingMain) || /\bfrom\s*['"]react(?:-dom)?(?:\/[^'"]*)?['"]/.test(files[existingMain]))));

  // 1. Add base template files if not present in files
  if (!files['/package.json'] && !files['package.json']) {
    if (isFullStack) {
      const fullStackPackageJson = {
        name: projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'concurrently "npm run dev:client" "npm run dev:server"',
          'dev:client': 'vite',
          'dev:server': 'node server/index.js',
          start: 'node server/index.js',
          build: 'vite build'
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
          'lucide-react': '^0.344.0',
          express: '^4.19.2',
          cors: '^2.8.5'
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.2.1',
          concurrently: '^8.2.2',
          vite: '^5.1.4'
        }
      };
      zip.file('package.json', JSON.stringify(fullStackPackageJson, null, 2));
    } else if (isReactProject) {
      zip.file('package.json', basicReactTemplate['package.json'].file.contents.trim());
    } else {
      zip.file('package.json', JSON.stringify({
        name: projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'brainhalf-project',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        devDependencies: { vite: '^5.1.4' },
      }, null, 2));
    }
  }
  if (isReactProject && !Object.keys(files).some(path => /^\/vite\.config\.(?:js|ts|mjs|mts|cjs|cts)$/.test(path))) {
    const viteConfig = isFullStack 
      ? `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
`
      : basicReactTemplate['vite.config.js'].file.contents.trim();
    zip.file('vite.config.js', viteConfig);
  }
  if (!files['/index.html'] && mainEntry) {
    zip.file('index.html', basicReactTemplate['index.html'].file.contents.trim().replace('/src/main.jsx', mainEntry));
  }
  if (!existingMain && appEntry && mainEntry) {
    const stylesheet = Object.keys(files).find(path => /^\/(?:src\/)?(?:styles|index|App)\.css$/.test(path));
    const cssImport = stylesheet ? `import ${JSON.stringify(relativeProjectImport(mainEntry, stylesheet))};\n` : '';
    zip.file(mainEntry.slice(1), `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from ${JSON.stringify(relativeProjectImport(mainEntry, appEntry))};
${cssImport}
createRoot(document.getElementById('root')).render(<App />);
`);
  }

  // 2. Add all custom generated files (with Zip Slip validation)
  for (const [rawPath, content] of Object.entries(files)) {
    if (!isSafeFilePath(rawPath)) continue;
    const cleanPath = normalizePath(rawPath, { leadingSlash: false });
    if (!cleanPath) continue;
    zip.file(cleanPath, content);
  }

  // 3. Add README.md with run instructions for both frontend and backend
  const readmeContent = isFullStack 
    ? `# ${projectName} (Full-Stack Application)

Built with [BrainHalf AI Code Studio](https://brainhalf.com).

## Architecture
- **Frontend**: React + Vite SPA (located in \`/src\`)
- **Backend**: Node.js + Express REST API (located in \`/server\`)
- **Database**: See the project schema and backend configuration; hosted data is not included.
- **Configuration**: Copy the empty environment template and supply your own server credentials. See BRAINHALF_EXPORT.md.

## Getting Started

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Run full-stack development servers:
\`\`\`bash
npm run dev
\`\`\`
- Frontend client: http://localhost:5173
- Backend API server: http://localhost:3001

3. Production build & run:
\`\`\`bash
npm run build
npm start
\`\`\`
`
    : `# ${projectName}

Built with [BrainHalf AI Code Studio](https://brainhalf.com).

## Getting Started

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Run development server:
\`\`\`bash
npm run dev
\`\`\`

3. Build for production:
\`\`\`bash
npm run build
\`\`\`
`;
  if (!files['/README.md']) zip.file('README.md', files['/server/README.md'] || readmeContent);

  return await zip.generateAsync({ type: 'blob' });
}

export async function exportProjectAsZip(files: Record<string, string>, projectName: string = 'brainhalf-project') {
  const blob = await generateProjectZipBlob(files, projectName);
  if (typeof document !== 'undefined') {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    const safeFilename = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.zip';
    link.download = safeFilename || 'brainhalf-project.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  }
  return blob;
}
