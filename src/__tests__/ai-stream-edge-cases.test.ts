import { describe, it, expect } from 'vitest';
import { parseMessageSegments } from '../lib/message-parser';
import { transform } from 'sucrase';

describe('AI Output Robustness & Sucrase Transpile Compatibility', () => {
  it('handles multi-file generation where first file lacks closing tag', () => {
    const aiOutput = `<file path="src/App.jsx">
import React from 'react';

export default function App() {
  return <div>Hello</div>;
}
<file path="src/styles.css">
body {
  margin: 0;
  padding: 0;
}
</file>`;

    const { fileMap } = parseMessageSegments(aiOutput, true);
    expect(fileMap['src/App.jsx']).toBeDefined();
    expect(fileMap['src/styles.css']).toBeDefined();

    // Check that src/App.jsx does NOT contain styles.css content!
    expect(fileMap['src/App.jsx']).not.toContain('body {');
    expect(fileMap['src/App.jsx']).not.toContain('margin: 0;');

    // Test that Sucrase can transpile App.jsx cleanly!
    expect(() => {
      transform(fileMap['src/App.jsx'], { transforms: ['typescript', 'jsx'] });
    }).not.toThrow();
  });

  it('handles code wrapped in markdown code fence with explanation at the bottom', () => {
    const aiOutput = `<file path="src/App.jsx">
\`\`\`jsx
import React from 'react';

export default function App() {
  return <h1>Dashboard</h1>;
}
\`\`\`
Hope this helps! You can customize the dashboard components.
</file>`;

    const { fileMap } = parseMessageSegments(aiOutput, true);
    expect(fileMap['src/App.jsx']).toBeDefined();
    expect(fileMap['src/App.jsx']).not.toContain('Hope this helps!');

    // Test that Sucrase transpiles it cleanly without Unexpected token, expected ";"
    expect(() => {
      transform(fileMap['src/App.jsx'], { transforms: ['typescript', 'jsx'] });
    }).not.toThrow();
  });
});
