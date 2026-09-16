import JSZip from 'jszip';
import { basicReactTemplate } from './templates';
import { normalizePath, isSafeFilePath } from './utils';

export async function generateProjectZipBlob(files: Record<string, string>, projectName: string = 'brainhalf-project') {
  const zip = new JSZip();

  const isFullStack = Object.keys(files).some(p => p.startsWith('/server/') || p.startsWith('server/') || p.includes('.env'));

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
    } else {
      zip.file('package.json', basicReactTemplate['package.json'].file.contents.trim());
    }
  }
  if (!files['/vite.config.js'] && !files['vite.config.js']) {
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
  if (!files['/index.html'] && !files['index.html']) {
    zip.file('index.html', basicReactTemplate['index.html'].file.contents.trim());
  }
  if (!files['/src/main.jsx'] && !files['src/main.jsx']) {
    zip.file('src/main.jsx', basicReactTemplate['src'].directory['main.jsx'].file.contents.trim());
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
- **Database**: SQLite / In-Memory Preview Data Layer (located in \`/server/db.js\`)
- **Configuration**: Environment variables in \`/server/.env\`

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
  zip.file('README.md', readmeContent);

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
