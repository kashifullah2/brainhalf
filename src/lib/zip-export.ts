import JSZip from 'jszip';
import { basicReactTemplate } from './templates';

export async function exportProjectAsZip(files: Record<string, string>, projectName: string = 'brainhalf-project') {
  const zip = new JSZip();

  // 1. Add base template files if not present in files
  if (!files['/package.json'] && !files['package.json']) {
    zip.file('package.json', basicReactTemplate['package.json'].file.contents.trim());
  }
  if (!files['/vite.config.js'] && !files['vite.config.js']) {
    zip.file('vite.config.js', basicReactTemplate['vite.config.js'].file.contents.trim());
  }
  if (!files['/index.html'] && !files['index.html']) {
    zip.file('index.html', basicReactTemplate['index.html'].file.contents.trim());
  }
  if (!files['/src/main.jsx'] && !files['src/main.jsx']) {
    zip.file('src/main.jsx', basicReactTemplate['src'].directory['main.jsx'].file.contents.trim());
  }

  // 2. Add all custom generated files
  for (const [rawPath, content] of Object.entries(files)) {
    const cleanPath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
    zip.file(cleanPath, content);
  }

  // 3. Add README.md with run instructions
  const readmeContent = `# ${projectName}

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

  // 4. Generate zip blob and trigger download
  const blob = await zip.generateAsync({ type: 'blob' });
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
