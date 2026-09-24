import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist-worker', { recursive: true });

copyFileSync('index.html', 'dist/index.html');
copyFileSync('app.js', 'dist/app.js');
copyFileSync('styles.css', 'dist/styles.css');

await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist-worker/index.js',
  sourcemap: false,
  minify: false,
  target: 'es2022'
});

console.log('Build complete: dist/ and dist-worker/');