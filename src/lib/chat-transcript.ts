/** Display metadata only: tool arguments and provider protocol never enter a chat bubble. */
export const TOOL_LABELS: Record<string, string> = {
  read_attachment: 'Read an uploaded document', use_attachment: 'Added an upload to the app',
  read_file: 'Read a file', read_files: 'Read files', list_files: 'Listed project files',
  write_file: 'Updated a file', edit_file: 'Edited a file', delete_file: 'Deleted a file',
  run_command: 'Ran a command', execute_command: 'Ran a command',
  search: 'Searched the project', search_files: 'Searched project files',
};

export function toolNames(value: string): string[] {
  const body = value.replace(/^(?:<[^>]+>|```[^\n]*\n)\s*/, '').trim();
  const nested = [...body.matchAll(/<(tool_call|function_call)\b[^>]*>[\s\S]*?<\/\1>/gi)];
  if (nested.length) return nested.flatMap(match => toolNames(match[0].replace(/<\/(?:tool_call|function_call)>$/i, '')));
  try {
    const parsed = JSON.parse(body);
    const calls = parsed.tool_calls || parsed.function_calls || parsed.function_call || parsed;
    const names = (Array.isArray(calls) ? calls : [calls]).map(call => call?.function?.name || call?.name || call?.toolName || call?.tool).filter((name): name is string => typeof name === 'string');
    if (names.length) return names;
  } catch { /* XML, token-delimited, or an unfinished JSON call. */ }
  const names = [...value.matchAll(/(?:<(?:invoke|tool_call|function_call)\b[^>]*?\bname=["']|\bfunctions\.)([\w.-]+)/g)].map(match => match[1].replace(/^functions\./, ''));
  if (!names.length) {
    const first = body.match(/^\s*\{\s*"(?:name|tool|toolName)"\s*:\s*"([\w.-]+)/);
    if (first) names.push(first[1]);
  }
  return names.length ? names : ['tool'];
}

export function toolSummaryMarkup(names: string[]): string {
  return `<agent-tools>${names.map(name => /^[\w.-]{1,80}$/.test(name) ? name : 'tool').join('|')}</agent-tools>`;
}

export function isSystemContinuation(content: string): boolean {
  return /^\s*(?:\[(?:AUTO-RETRY-FULL-APP|AUTO-FIX|AUTO-CONTINUE|SYSTEM-CONTINUATION)\]|The previous response ended with an unfinished file\.)/i.test(content);
}

const OPEN = /<(tool_calls?|function_calls?|invoke|agent-tools)\b[^>]*>|<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>|```(?:tool_call|function_call)s?\s*\n|<(file|edit)\s+path=["'][^"']+["']>|```[^\n]*\n|<(\/?)[｜|]DSML[｜|]([a-z_]+)?(?:\s[^>]*)?>/gi;
const PREFIXES = ['<tool_call', '<tool_calls', '<function_call', '<function_calls', '<invoke', '<agent-tools', '<|tool_calls_section_begin|>', '<|tool_call_begin|>', '<｜dsml｜', '</｜dsml｜', '<|dsml|', '</|dsml|', '<file ', '<edit ', '```'];

// Some models emit self-closing XML tool calls like <read_file path="..." /> that
// bypass the OPEN/PREFIXES filter (which handles open/close tag pairs). Strip and
// convert them to canonical agent-tools summaries before the stream filter runs.
const SELF_CLOSING_TOOL_RE = /<(read_files?|write_file|edit_file|delete_file|list_files?|search_files?|execute_command|run_command)\b[^>]*?\/\s*>/gi;
export function stripSelfClosingTools(content: string): string {
  return content.replace(SELF_CLOSING_TOOL_RE, (_, name: string) => toolSummaryMarkup([name]));
}

function pendingStart(text: string): number {
  const lower = text.toLowerCase();
  for (let index = Math.max(0, text.lastIndexOf('<')); index < text.length; index++) {
    if (text[index] !== '<' && text[index] !== '`') continue;
    const tail = lower.slice(index);
    if (PREFIXES.some(prefix => prefix.startsWith(tail) || tail.startsWith(prefix) && !tail.includes('>'))) return index;
  }
  const fence = text.lastIndexOf('```');
  if (fence >= 0 && !text.slice(fence).includes('\n')) return fence;
  const partialFence = text.match(/`{1,2}$/);
  if (partialFence) return text.length - partialFence[0].length;
  return text.length;
}

function suffixLength(text: string, marker: string): number {
  for (let size = Math.min(text.length, marker.length - 1); size > 0; size--) {
    if (marker.toLowerCase().startsWith(text.slice(-size).toLowerCase())) return size;
  }
  return 0;
}

/** Incremental server filter; retains only a partial marker or an active tool block. */
export class ToolTranscriptStream {
  private pending = '';
  private protectedEnd = '';
  private toolEnd = '';
  private toolBody = '';
  private canonical = false;
  private dataFence = '';
  private providerProtocol = false;

  push(chunk: string, done = false): string {
    this.pending += chunk;
    let output = '';
    while (this.pending) {
      if (this.protectedEnd) {
        const end = this.pending.toLowerCase().indexOf(this.protectedEnd);
        if (end < 0) {
          const keep = done ? 0 : suffixLength(this.pending, this.protectedEnd);
          output += this.pending.slice(0, this.pending.length - keep);
          this.pending = this.pending.slice(this.pending.length - keep);
          break;
        }
        output += this.pending.slice(0, end + this.protectedEnd.length);
        this.pending = this.pending.slice(end + this.protectedEnd.length);
        this.protectedEnd = '';
        continue;
      }
      if (this.toolEnd) {
        const end = this.pending.toLowerCase().indexOf(this.toolEnd);
        if (end < 0 && !done) {
          // Bound retained arguments; the UI only needs the tool names.
          const keep = suffixLength(this.pending, this.toolEnd);
          const body = this.toolBody + this.pending.slice(0, this.pending.length - keep);
          this.toolBody = this.dataFence ? body : body.slice(0, 32_768);
          this.pending = this.pending.slice(this.pending.length - keep);
          break;
        }
        this.toolBody += end < 0 ? this.pending : this.pending.slice(0, end);
        output += this.finishTool(end >= 0);
        this.pending = end < 0 ? '' : this.pending.slice(end + this.toolEnd.length);
        this.toolEnd = ''; this.toolBody = ''; this.canonical = false; this.dataFence = ''; this.providerProtocol = false;
        continue;
      }
      OPEN.lastIndex = 0;
      const match = OPEN.exec(this.pending);
      if (!match) {
        const start = pendingStart(this.pending);
        output += this.pending.slice(0, start);
        if (done && /^`{1,2}$/.test(this.pending.slice(start))) output += this.pending.slice(start);
        this.pending = done ? '' : this.pending.slice(start);
        break;
      }
      output += this.pending.slice(0, match.index);
      const marker = match[0].toLowerCase();
      this.pending = this.pending.slice(match.index + match[0].length);
      if (match[3] !== undefined) {
        // Raw DSML is provider syntax, not evidence that a tool actually ran.
        // Actual tool execution emits its own canonical summary separately.
        if (match[3] === '/') continue;
        this.providerProtocol = true;
        this.toolBody = '';
        this.toolEnd = '</' + marker.slice(1).split(/[\s>]/)[0] + '>';
      } else if (/^```(?:json|xml|text|plaintext)?\s*\n$/.test(marker)) {
        // Provider protocols are sometimes wrapped in a plain JSON/XML fence.
        // Hold these until classified so no arguments flash during streaming.
        this.dataFence = match[0];
        this.toolEnd = '```';
        this.toolBody = '';
      } else if (match[2] || marker.startsWith('```') && !/^```(?:tool_call|function_call)/.test(marker)) {
        output += match[0];
        this.protectedEnd = match[2] ? `</${match[2].toLowerCase()}>` : '```';
      } else {
        this.canonical = match[1]?.toLowerCase() === 'agent-tools';
        this.toolBody = this.canonical ? '' : match[0];
        this.toolEnd = match[1] ? `</${match[1].toLowerCase()}>` : marker.startsWith('```') ? '```' : marker.includes('section') ? '<|tool_calls_section_end|>' : '<|tool_call_end|>';
      }
    }
    if (done && this.toolEnd) {
      output += this.finishTool(false);
      this.toolEnd = ''; this.toolBody = '';
    }
    return output;
  }

  private finishTool(closed: boolean): string {
    if (this.providerProtocol) return '';
    if (this.dataFence) {
      const body = this.toolBody.trim();
      if (/^(?:<(?:tool_calls?|function_calls?|invoke)\b|<\|tool_call|<[｜|]DSML[｜|])/i.test(body)) return formatToolTranscript(body, closed);
      if (/^\{\s*"(?:tool_calls|function_calls?)"\s*:/.test(body)) return toolSummaryMarkup(toolNames(body));
      return this.dataFence + this.toolBody + (closed ? '```' : '');
    }
    return toolSummaryMarkup(this.canonical ? this.toolBody.split('|').filter(Boolean) : toolNames(this.toolBody));
  }
}

export function formatToolTranscript(content: string, done = true): string {
  return new ToolTranscriptStream().push(stripSelfClosingTools(content), done);
}
