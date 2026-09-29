import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BuildProgress from '../components/BuildProgress';

describe('BuildProgress', () => {
  it('labels untouched files as Unchanged instead of the cryptic Available', () => {
    const html = renderToStaticMarkup(
      <BuildProgress files={['/src/App.tsx', '/package.json']} progress={{ '/src/App.tsx': 'saved' }} building={false} />,
    );
    expect(html).toContain('Saved');
    expect(html).toContain('Unchanged');
    expect(html).not.toContain('Available');
  });

  it('shows Ready in the header when idle instead of Available', () => {
    const html = renderToStaticMarkup(
      <BuildProgress files={['/package.json']} progress={{}} building={false} />,
    );
    expect(html).toContain('Ready');
    expect(html).not.toContain('Available');
  });

  it('still shows build states while building', () => {
    const html = renderToStaticMarkup(
      <BuildProgress files={['/src/App.tsx']} progress={{ '/src/App.tsx': 'writing' }} building={true} />,
    );
    expect(html).toContain('Writing…');
  });
});
