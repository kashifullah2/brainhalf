import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportProjectAsZip } from '../lib/zip-export';
import JSZip from 'jszip';

describe('Zip Export & Project Bundling', () => {
  let createdLink: any = null;
  let clicked = false;
  let appended = false;
  let removed = false;

  beforeEach(() => {
    clicked = false;
    appended = false;
    removed = false;
    createdLink = {
      href: '',
      download: '',
      click: vi.fn(() => { clicked = true; }),
    };

    // Setup global DOM mocks if not present
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') return createdLink;
        return {};
      }),
      body: {
        appendChild: vi.fn((node) => {
          if (node === createdLink) appended = true;
        }),
        removeChild: vi.fn((node) => {
          if (node === createdLink) removed = true;
        }),
      },
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:brainhalf-mock-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('generates base template files and README for a basic project', async () => {
    const fileSpy = vi.spyOn(JSZip.prototype, 'file');

    const files = {
      '/src/App.jsx': 'export default function App() { return <div>Hello</div>; }',
    };

    await exportProjectAsZip(files, 'My Awesome App');

    expect(fileSpy).toHaveBeenCalledWith('package.json', expect.any(String));
    expect(fileSpy).toHaveBeenCalledWith('vite.config.js', expect.any(String));
    expect(fileSpy).toHaveBeenCalledWith('index.html', expect.any(String));
    expect(fileSpy).toHaveBeenCalledWith('src/main.jsx', expect.any(String));
    expect(fileSpy).toHaveBeenCalledWith('src/App.jsx', files['/src/App.jsx']);
    expect(fileSpy).toHaveBeenCalledWith('README.md', expect.stringContaining('# My Awesome App'));

    // Verify DOM download trigger
    expect(createdLink.download).toBe('my-awesome-app.zip');
    expect(createdLink.href).toBe('blob:brainhalf-mock-url');
    expect(appended).toBe(true);
    expect(clicked).toBe(true);
    expect(removed).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:brainhalf-mock-url');
  });

  it('does not overwrite custom package.json or vite.config.js if already provided by user', async () => {
    const fileSpy = vi.spyOn(JSZip.prototype, 'file');

    const customPackageJson = '{"name": "custom-app", "version": "1.0.0"}';
    const files = {
      'package.json': customPackageJson,
      '/src/App.jsx': 'export default function App() {}',
    };

    await exportProjectAsZip(files, 'Custom App');

    // Should include custom package.json and not the template one
    expect(fileSpy).toHaveBeenCalledWith('package.json', customPackageJson);
    // Should only have been called with package.json once
    const packageJsonCalls = fileSpy.mock.calls.filter(call => call[0] === 'package.json');
    expect(packageJsonCalls.length).toBe(1);
  });

  it('ignores unsafe path traversals like Zip Slip attempts', async () => {
    const fileSpy = vi.spyOn(JSZip.prototype, 'file');

    const files = {
      '/src/App.jsx': 'export default function App() {}',
      '../../../../etc/passwd': 'root:x:0:0',
      '../evil.sh': 'rm -rf /',
    };

    await exportProjectAsZip(files, 'Safe Test');

    expect(fileSpy).toHaveBeenCalledWith('src/App.jsx', files['/src/App.jsx']);
    expect(fileSpy).not.toHaveBeenCalledWith(expect.stringContaining('passwd'), expect.any(String));
    expect(fileSpy).not.toHaveBeenCalledWith(expect.stringContaining('evil.sh'), expect.any(String));
  });

  it('sanitizes non-alphanumeric project names for safe file download name', async () => {
    const files = {
      '/src/App.jsx': 'export default function App() {}',
    };

    await exportProjectAsZip(files, 'Dangerous / Project @#$% 123!');
    expect(createdLink.download).toBe('dangerous---project------123-.zip');
  });
});
