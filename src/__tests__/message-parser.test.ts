import { describe, it, expect } from 'vitest';
import {
  parseEditPairs,
  applyEditsToFile,
  parseMessageSegments,
  parseMessageSegmentsMemoized
} from '../lib/message-parser';

describe('Message Parser & Surgical Diff Engine', () => {
  describe('parseEditPairs', () => {
    it('parses standard <search> and <replace> tags', () => {
      const raw = `
<search>
const a = 1;
</search>
<replace>
const a = 2;
</replace>
      `;
      const edits = parseEditPairs(raw);
      expect(edits).toEqual([
        { search: 'const a = 1;', replace: 'const a = 2;' }
      ]);
    });

    it('parses multiple search/replace pairs in a single block', () => {
      const raw = `
<search>
const x = 10;
</search>
<replace>
const x = 20;
</replace>
<search>
const y = 30;
</search>
<replace>
const y = 40;
</replace>
      `;
      const edits = parseEditPairs(raw);
      expect(edits).toHaveLength(2);
      expect(edits[0]).toEqual({ search: 'const x = 10;', replace: 'const x = 20;' });
      expect(edits[1]).toEqual({ search: 'const y = 30;', replace: 'const y = 40;' });
    });

    it('parses git diff style search and replace blocks', () => {
      const raw = `<<<<<<< SEARCH
function greet() {
  return "hi";
}
=======
function greet() {
  return "hello world";
}
>>>>>>> REPLACE`;
      const edits = parseEditPairs(raw);
      expect(edits).toEqual([
        {
          search: 'function greet() {\n  return "hi";\n}',
          replace: 'function greet() {\n  return "hello world";\n}'
        }
      ]);
    });
  });

  describe('applyEditsToFile', () => {
    it('preserves replacement metacharacters literally in generated code', () => {
      const replacement = 'const value = "$& $$ $` $\'";';
      expect(applyEditsToFile('before\nold\nafter', [{ search: 'old', replace: replacement }])).toBe(`before\n${replacement}\nafter`);
      expect(applyEditsToFile('before\r\nold\r\nvalue\r\nafter', [{ search: 'old\nvalue', replace: replacement }])).toBe(`before\n${replacement}\nafter`);
    });
    it('applies exact search and replace correctly', () => {
      const original = `import React from 'react';\n\nexport default function App() {\n  return <div>Old</div>;\n}`;
      const edits = [
        { search: '<div>Old</div>', replace: '<div>New Content</div>' }
      ];
      const result = applyEditsToFile(original, edits);
      expect(result).toContain('<div>New Content</div>');
      expect(result).not.toContain('<div>Old</div>');
    });

    it('handles CRLF and LF line ending differences', () => {
      const original = 'line1\r\nline2\r\nline3';
      const edits = [
        { search: 'line2', replace: 'line2_modified' }
      ];
      const result = applyEditsToFile(original, edits);
      expect(result).toContain('line2_modified');
    });

    it('matches blocks with differing indentation or leading whitespace', () => {
      const original = `function test() {\n    const x = 1;\n    const y = 2;\n    return x + y;\n}`;
      const edits = [
        {
          search: 'const x = 1;\nconst y = 2;\nreturn x + y;',
          replace: 'const sum = 3;\nreturn sum;'
        }
      ];
      const result = applyEditsToFile(original, edits);
      expect(result).toContain('const sum = 3;');
    });

    it('gracefully returns original content if search string is not found', () => {
      const original = `const unchanged = true;`;
      const edits = [
        { search: 'nonexistent code', replace: 'replacement' }
      ];
      const result = applyEditsToFile(original, edits);
      expect(result).toBe(original);
    });

    it('handles empty original content or empty edits array safely', () => {
      expect(applyEditsToFile('', [{ search: 'a', replace: 'b' }])).toBe('');
      expect(applyEditsToFile('hello', [])).toBe('hello');
    });

    it('matches blocks with varying internal whitespace or blank line differences', () => {
      const original = `function render() {\n  const [count, setCount] = useState(0);\n  \n  return <div>{count}</div>;\n}`;
      const edits = [
        {
          search: 'const [count, setCount] = useState(0);\nreturn <div>{count}</div>;',
          replace: 'const [count, setCount] = useState(10);\nreturn <span>{count}</span>;'
        }
      ];
      const result = applyEditsToFile(original, edits);
      expect(result).toContain('useState(10)');
      expect(result).toContain('<span>{count}</span>');
    });
  });

  describe('parseMessageSegments', () => {
    it('shows entrypoint filenames without relabeling them as the application component', () => {
      const { segments } = parseMessageSegments('<file path="src/main.jsx">createRoot(root).render(<App />);</FILE>', true);
      expect(segments[0]).toMatchObject({ type: 'file', path: 'src/main.jsx', content: 'createRoot(root).render(<App />);' });
    });

    it('keeps JSON code fences out of stylesheet files', () => {
      const { fileMap } = parseMessageSegments('```json\n{"dependencies":{"react":"^19.0.0"}}\n```', true);
      expect(fileMap['package.json']).toContain('dependencies');
      expect(fileMap['src/styles.css']).toBeUndefined();
    });

    it('can exclude unfinished edit pairs from server-side application', () => {
      expect(parseEditPairs('<search>remove me</search>', false)).toEqual([]);
      expect(parseEditPairs('<search>old</search><replace>new', false)).toEqual([]);
      expect(parseEditPairs('<search>old</search><replace>new</replace>', false)).toEqual([{ search: 'old', replace: 'new' }]);
    });
    it('parses <file> tags and populates fileMap', () => {
      const msg = `Here is the main component:\n<file path="src/App.jsx">\nexport default function App() { return <h1>Hello</h1>; }\n</file>\nDone!`;
      const { segments, fileMap } = parseMessageSegments(msg, true);

      expect(fileMap['src/App.jsx']).toContain('export default function App()');
      const fileSeg = segments.find(s => s.type === 'file');
      expect(fileSeg).toBeDefined();
      if (fileSeg && fileSeg.type === 'file') {
        expect(fileSeg.path).toBe('src/App.jsx');
        expect(fileSeg.isStreaming).toBe(false);
      }
    });

    it('parses <edit> tags and populates editsMap', () => {
      const msg = `Fixing the button:\n<edit path="src/components/Button.jsx">\n<search>\n<button>Old</button>\n</search>\n<replace>\n<button>New</button>\n</replace>\n</edit>`;
      const { segments, editsMap } = parseMessageSegments(msg, true);

      expect(editsMap['src/components/Button.jsx']).toEqual([
        { search: '<button>Old</button>', replace: '<button>New</button>' }
      ]);
      const editSeg = segments.find(s => s.type === 'edit');
      expect(editSeg).toBeDefined();
    });

    it('parses <plan> and <command> tags', () => {
      const msg = `<plan>\n1. Step one\n2. Step two\n</plan>\n<command>npm install lodash</command>`;
      const { segments } = parseMessageSegments(msg, true);

      const planSeg = segments.find(s => s.type === 'plan');
      const cmdSeg = segments.find(s => s.type === 'command');

      expect(planSeg).toBeDefined();
      expect(cmdSeg).toBeDefined();
      if (cmdSeg && cmdSeg.type === 'command') {
        expect(cmdSeg.command).toBe('npm install lodash');
      }
    });

    it('extracts fallback markdown code fences when model forgets <file> tags', () => {
      const msg = `Here is your src/styles.css file:\n\`\`\`css\nbody { background: #000; }\n\`\`\``;
      const { fileMap } = parseMessageSegments(msg, true);

      expect(fileMap['src/styles.css']).toContain('background: #000;');
    });
  });

  describe('parseMessageSegmentsMemoized (the render hot path)', () => {
    it('returns the same shape as a direct parse', () => {
      const msg = '<plan>Build it</plan><file path="src/App.jsx"><content>export default 1;</content></file>';
      const direct = parseMessageSegments(msg, true);
      const cached = parseMessageSegmentsMemoized(msg, true);
      expect(cached.segments).toEqual(direct.segments);
      expect(cached.fileMap).toEqual(direct.fileMap);
    });

    it('hands back the very same result object for a repeat call', () => {
      // A reference-equal hit is what saves the work: a deep-equal copy would
      // still have parsed it.
      const msg = '<file path="src/App.jsx"><content>x</content></file>';
      const first = parseMessageSegmentsMemoized(msg, true);
      const second = parseMessageSegmentsMemoized(msg, true);
      expect(second).toBe(first);
    });

    it('caches the streaming and the finished parse separately', () => {
      // The same partial content parses differently depending on whether the
      // stream is mid-flight, so the flag is part of the key.
      const msg = '<file path="src/App.jsx"><content>partial';
      const streaming = parseMessageSegmentsMemoized(msg, false);
      const done = parseMessageSegmentsMemoized(msg, true);
      expect(streaming).not.toBe(done);
      expect(parseMessageSegmentsMemoized(msg, false)).toBe(streaming);
      expect(parseMessageSegmentsMemoized(msg, true)).toBe(done);
    });

    it('re-parses when the content moves', () => {
      const a = parseMessageSegmentsMemoized('<plan>A</plan>', true);
      const b = parseMessageSegmentsMemoized('<plan>B</plan>', true);
      expect(b).not.toBe(a);
    });

    it('does not grow past the entry cap', () => {
      // Distinct contents are distinct entries; the oldest is evicted rather
      // than the map growing for the life of the tab.
      const first = parseMessageSegmentsMemoized('<plan>first</plan>', true);
      for (let i = 0; i < 200; i++) {
        parseMessageSegmentsMemoized(`<plan>filler-${i}</plan>`, true);
      }
      // `first` is long gone from the cache, so this must have parsed again.
      expect(parseMessageSegmentsMemoized('<plan>first</plan>', true)).not.toBe(first);
    });
  });
});
