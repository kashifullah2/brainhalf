import { describe, expect, it } from 'vitest';
import { formatToolTranscript, isSystemContinuation, ToolTranscriptStream } from '../lib/chat-transcript';
import { parseMessageSegments } from '../lib/message-parser';

describe('Tool transcript presentation', () => {
  const raw = '<tool_call>{"name":"read_file","arguments":{"path":"/src/App.tsx","secret":"do not show"}}</tool_call>';

  it.each([
    '<｜DSML｜>\n' + raw + '\n</｜DSML｜>',
    '<｜DSML｜function_calls><｜DSML｜invoke name="read_file"><｜DSML｜parameter name="path" string="true">private</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>',
    '<|DSML|>private</|DSML|>',
  ])('hides DSML at every stream boundary without implying a tool executed', source => {
    for (let split = 1; split < source.length; split++) {
      const stream = new ToolTranscriptStream();
      expect(stream.push('Before ' + source.slice(0, split))).toBe('Before ');
      expect(stream.push(source.slice(split) + ' After') + stream.push('', true)).toBe(' After');
    }
    const stream = new ToolTranscriptStream();
    expect([...source].map(character => stream.push(character)).join('') + stream.push('', true)).toBe('');
    expect(formatToolTranscript('```xml\n' + source + '\n```')).toBe('');
    const code = `<file path="/src/example.ts">export const fixture = ${JSON.stringify(source)};</file>`;
    expect(formatToolTranscript(code)).toBe(code);
    expect(formatToolTranscript('Done.</｜DSML｜>')).toBe('Done.');
  });

  it.each([raw, '<function_calls><invoke name="read_file"><parameter name="path">private</parameter></invoke></function_calls>', '<|tool_calls_section_begin|><|tool_call_begin|>functions.read_file:0<|tool_call_argument_begin|>{"path":"private"}<|tool_call_end|><|tool_calls_section_end|>', '```tool_call\n{"name":"read_file","arguments":"private"}\n```'])('converts provider blocks to display metadata: %s', source => {
    const result = formatToolTranscript(`Before ${source} After`);
    expect(result).toContain('<agent-tools>read_file');
    expect(result).not.toMatch(/private|arguments|tool_call|function_call|do not show/);
    expect(result.startsWith('Before ')).toBe(true);
    expect(result.endsWith(' After')).toBe(true);
  });

  it('never leaks fragmented tool arguments at any stream boundary', () => {
    for (let split = 1; split < raw.length; split++) {
      const stream = new ToolTranscriptStream();
      const first = stream.push(raw.slice(0, split));
      expect(first).toBe('');
      expect(first + stream.push(raw.slice(split)) + stream.push('', true)).toBe('<agent-tools>read_file</agent-tools>');
    }
    const stream = new ToolTranscriptStream();
    const result = [...`Before ${raw} After`].map(character => stream.push(character)).join('') + stream.push('', true);
    expect(result).toBe('Before <agent-tools>read_file</agent-tools> After');
  });

  it('preserves generated source containing protocol strings, quotes and split code fences', () => {
    const source = `<file path="/src/parser.ts">export const fixture = '${raw}';</file>\n\`\`\`ts\nconst value = 1;\n\`\`\`\nDone.`;
    const stream = new ToolTranscriptStream();
    expect([...source].map(character => stream.push(character)).join('') + stream.push('', true)).toBe(source);
    expect(parseMessageSegments(source, true).fileMap['src/parser.ts']).toContain(raw);
  });

  it('suppresses unfinished tool blocks and parses canonical summaries without rendering markup', () => {
    expect(formatToolTranscript('Reading <tool_call>{"name":"read_file","arguments":"secret', false)).toBe('Reading ');
    const parsed = parseMessageSegments(`Reading ${raw} Done`, true);
    expect(parsed.segments).toEqual([{ type: 'text', content: 'Reading ' }, { type: 'tools', names: ['read_file'] }, { type: 'text', content: ' Done' }]);
    expect(formatToolTranscript('Hello <tool_ca', false)).toBe('Hello ');
    expect(formatToolTranscript('<tool_call>{"name":"read_file","arguments":{"name":"not-a-tool"}}</tool_call>')).toBe('<agent-tools>read_file</agent-tools>');
    expect(formatToolTranscript('<function_calls><invoke name="read_file"><parameter name="path">private</parameter></invoke></function_calls>')).toBe('<agent-tools>read_file</agent-tools>');
  });

  it('recognizes internal retry prompts without hiding ordinary user discussion', () => {
    expect(isSystemContinuation('[AUTO-RETRY-FULL-APP] Continue the same task')).toBe(true);
    expect(isSystemContinuation('[Auto-Fix] Resolve the preview error')).toBe(true);
    expect(isSystemContinuation('The previous response ended with an unfinished file. Regenerate it.')).toBe(true);
    expect(isSystemContinuation('Explain what AUTO-RETRY-FULL-APP means')).toBe(false);
    expect(isSystemContinuation('Continue building my app')).toBe(false);
  });

  it('handles protocol-only JSON/XML fences while preserving ordinary JSON examples', () => {
    const raw = '```json\n{"tool_calls":[{"function":{"name":"read_file","arguments":{"name":"private"}}},{"function":{"name":"list_files"}}]}\n```';
    const stream = new ToolTranscriptStream();
    expect([...raw].map(character => stream.push(character)).join('') + stream.push('', true)).toBe('<agent-tools>read_file|list_files</agent-tools>');
    expect(formatToolTranscript('```xml\n<tool_calls><tool_call>{"name":"read_file"}</tool_call><tool_call>{"name":"list_files"}</tool_call></tool_calls>\n```')).toBe('<agent-tools>read_file|list_files</agent-tools>');
    const example = '```json\n{"name":"My app","theme":"dark"}\n```';
    expect(formatToolTranscript(example)).toBe(example);
  });

  it('preserves inline code and text after closing backticks at every stream boundary', () => {
    for (const sentence of ['Use `npm install` to start.', 'The file is `App.tsx`', 'An inline ``code`` example.']) {
      expect(formatToolTranscript(sentence)).toBe(sentence);
      for (let split = 1; split < sentence.length; split++) {
        const stream = new ToolTranscriptStream();
        expect(stream.push(sentence.slice(0, split)) + stream.push(sentence.slice(split)) + stream.push('', true)).toBe(sentence);
      }
    }
  });
});
