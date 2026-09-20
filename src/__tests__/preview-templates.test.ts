import { describe, it, expect } from 'vitest';
import {
  PREVIEW_ERROR_CARD_SRC,
  STARTER_APP_JSX,
  STARTER_MAIN_JSX,
  STARTER_STYLES_CSS,
  buildCssJsModule,
  buildHarnessModuleSrc,
  buildMissingComponentStub,
  buildPreviewIndexHtml,
} from '../lib/preview-templates';

/**
 * These templates were inlined inside ChatAgent until 7.3; they were moved out
 * verbatim. Every one of them is source text that runs in the preview iframe,
 * so the extraction is only correct if the observable output is unchanged --
 * tsc cannot tell you whether a `\${...}` sequence survived as text, and neither
 * can the build. This pins the output the preview actually serves.
 */
describe('7.3 extracted preview templates', () => {
  it('seeds a complete React starter, not a partial one', () => {
    // A partially seeded workspace renders a broken preview; each file is
    // asserted on its own because the three are written in one transaction.
    expect(STARTER_APP_JSX).toMatch(/export default function App\(\)/);
    expect(STARTER_APP_JSX).toContain('lucide-react');
    expect(STARTER_MAIN_JSX).toMatch(/ReactDOM\.createRoot/);
    expect(STARTER_STYLES_CSS).toContain('box-sizing: border-box');
  });

  it('keeps the error card interpolation live, not evaluated', () => {
    // The card is interpolated into both the seeded main.jsx and the served
    // harness module. If the escape breaks, `this.state` resolves here instead
    // of in the browser and the card renders "[object Object]".
    for (const src of [PREVIEW_ERROR_CARD_SRC, STARTER_MAIN_JSX, buildHarnessModuleSrc()]) {
      expect(src).toContain('>Preview Error<');
      expect(src).toContain("${this.state.error?.message || 'A render error occurred.'}");
      expect(src).not.toContain('[object Object]');
    }
  });

  it('builds the preview index.html with the import map interpolated', () => {
    const html = buildPreviewIndexHtml('{ "imports": { "react": "https://esm.sh/react@18.2.0" } }');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>BrainHalf Edge Preview</title>');
    expect(html).toContain('{ "imports": { "react": "https://esm.sh/react@18.2.0" } }');
    // The mount path must survive: a preview that never calls mountApp() is
    // indistinguishable from a broken one until you notice it is blank.
    expect(html).toContain('mountApp();');
  });

  it('names the missing-component stub after the file, sanitised', () => {
    const stub = buildMissingComponentStub('/src/components/My Widget.jsx');
    expect(stub).toMatch(/export default function MyWidget\(props\)/);
    // The path is embedded via JSON.stringify, so it is quoted for the browser,
    // not for the template.
    expect(stub).toContain('"/src/components/My Widget.jsx"');
  });

  it('serves a css file as a JS module that also injects a style tag', () => {
    const module = buildCssJsModule('/src/styles.css', 'body { color: #fff; }');
    expect(module).toContain('el.textContent = "body { color: #fff; }"');
    expect(module).toContain('export default "body { color: #fff; }"');
  });
});
