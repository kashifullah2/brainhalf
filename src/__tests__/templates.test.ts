import { describe, it, expect } from 'vitest';
import { basicReactTemplate } from '../lib/templates';

describe('Project Starter Templates', () => {
  it('provides valid package.json with React and Lucide icons', () => {
    expect(basicReactTemplate['package.json']).toBeDefined();
    const pkgContent = basicReactTemplate['package.json'].file.contents;
    const parsed = JSON.parse(pkgContent.trim());

    expect(parsed.name).toBe('preview-app');
    expect(parsed.dependencies).toHaveProperty('react');
    expect(parsed.dependencies).toHaveProperty('react-dom');
    expect(parsed.dependencies).toHaveProperty('lucide-react');
    expect(parsed.devDependencies).toHaveProperty('vite');
  });

  it('provides valid vite.config.js referencing @vitejs/plugin-react', () => {
    expect(basicReactTemplate['vite.config.js']).toBeDefined();
    const viteConfig = basicReactTemplate['vite.config.js'].file.contents;
    expect(viteConfig).toContain('@vitejs/plugin-react');
    expect(viteConfig).toContain('defineConfig');
  });

  it('provides index.html with viewport meta and root mount node', () => {
    expect(basicReactTemplate['index.html']).toBeDefined();
    const indexHtml = basicReactTemplate['index.html'].file.contents;
    expect(indexHtml).toContain('<div id="root"></div>');
    expect(indexHtml).toContain('viewport');
    expect(indexHtml).toContain('/src/main.jsx');
  });

  it('provides src/main.jsx with ErrorBoundary and mount logic', () => {
    expect(basicReactTemplate['src'].directory['main.jsx']).toBeDefined();
    const mainJsx = basicReactTemplate['src'].directory['main.jsx'].file.contents;
    expect(mainJsx).toContain('ReactDOM.createRoot');
    expect(mainJsx).toContain('ErrorBoundary');
    expect(mainJsx).toContain("import App from './App.jsx'");
  });

  it('provides fallback src/App.jsx and styles.css', () => {
    expect(basicReactTemplate['src'].directory['App.jsx']).toBeDefined();
    const appJsx = basicReactTemplate['src'].directory['App.jsx'].file.contents;
    expect(appJsx).toContain('export default function App');

    expect(basicReactTemplate['src'].directory['styles.css']).toBeDefined();
    const css = basicReactTemplate['src'].directory['styles.css'].file.contents;
    expect(css.length).toBeGreaterThan(0);
  });
});
