export interface CodeEdit {
  search: string;
  replace: string;
}

export type MessageSegment = 
  | { type: 'text'; content: string }
  | { type: 'file'; path: string; content: string; isStreaming: boolean }
  | { type: 'edit'; path: string; rawContent: string; edits: CodeEdit[]; isStreaming: boolean }
  | { type: 'command'; command: string; isStreaming: boolean }
  | { type: 'plan'; content: string; isStreaming: boolean };

export interface ParseResult {
  segments: MessageSegment[];
  fileMap: Record<string, string>;
  editsMap: Record<string, CodeEdit[]>;
}

export function parseEditPairs(rawContent: string): CodeEdit[] {
  const edits: CodeEdit[] = [];
  
  // 1. Check for <search>...</search><replace>...</replace> pairs
  const tagRegex = /<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(rawContent)) !== null) {
    edits.push({
      search: match[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      replace: match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    });
  }

  if (edits.length > 0) return edits;

  // 2. Check for <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
  const diffRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/gi;
  while ((match = diffRegex.exec(rawContent)) !== null) {
    edits.push({
      search: match[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      replace: match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    });
  }
  if (edits.length > 0) return edits;

  // 3. Handle incomplete streaming search/replace
  const partialSearchMatch = rawContent.match(/<search>([\s\S]*?)(?:<\/search>)?\s*<replace>([\s\S]*?)$/i);
  if (partialSearchMatch) {
    edits.push({
      search: partialSearchMatch[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      replace: partialSearchMatch[2].replace(/^\r?\n/, '')
    });
    return edits;
  }

  // 4. Handle partial search only
  const searchOnlyMatch = rawContent.match(/<search>([\s\S]*?)(?:<\/search>)?$/i);
  if (searchOnlyMatch) {
    edits.push({
      search: searchOnlyMatch[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      replace: ''
    });
  }

  return edits;
}

export function applyEditsToFile(
  originalContent: string, 
  edits: CodeEdit[]
): string {
  if (!originalContent || !edits || edits.length === 0) return originalContent;
  
  let result = originalContent;

  for (const { search, replace } of edits) {
    if (!search) continue;

    // 1. Direct exact match
    if (result.includes(search)) {
      result = result.replace(search, replace);
      continue;
    }

    // 2. Normalized line endings (CRLF -> LF)
    const normResult = result.replace(/\r\n/g, '\n');
    const normSearch = search.replace(/\r\n/g, '\n');
    const normReplace = replace.replace(/\r\n/g, '\n');

    if (normResult.includes(normSearch)) {
      result = normResult.replace(normSearch, normReplace);
      continue;
    }

    // 3. Trimmed line-by-line block match
    const resultLines = normResult.split('\n');
    const searchLines = normSearch.split('\n').filter(l => l.trim().length > 0);
    
    if (searchLines.length > 0) {
      let matchIndex = -1;
      for (let i = 0; i <= resultLines.length - searchLines.length; i++) {
        let allMatch = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (resultLines[i + j].trim() !== searchLines[j].trim()) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex !== -1) {
        const before = resultLines.slice(0, matchIndex);
        const after = resultLines.slice(matchIndex + searchLines.length);
        result = [...before, normReplace, ...after].join('\n');
        continue;
      }
    }

    // 4. Single-line trimmed match
    if (searchLines.length === 1) {
      const singleSearch = searchLines[0].trim();
      const lineIdx = resultLines.findIndex(l => l.trim() === singleSearch);
      if (lineIdx !== -1) {
        resultLines[lineIdx] = normReplace;
        result = resultLines.join('\n');
      }
    }
  }

  return result;
}

// Helper to detect and extract standard markdown code blocks when a model forgets <file> tags
function extractMarkdownCodeBlocks(
  text: string, 
  isStreamDone: boolean, 
  fileMap: Record<string, string>
): MessageSegment[] {
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)(?:```|$)/g;
  
  if (!text.includes('```')) {
    return text.trim() ? [{ type: 'text', content: text }] : [];
  }

  const resultSegments: MessageSegment[] = [];
  let lastIdx = 0;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = codeBlockRegex.exec(text)) !== null) {
    const textBefore = text.substring(lastIdx, blockMatch.index);
    if (textBefore.trim()) {
      resultSegments.push({ type: 'text', content: textBefore });
    }

    const lang = (blockMatch[1] || '').toLowerCase().trim();
    const rawCode = blockMatch[2] || '';
    const isClosed = blockMatch[0].endsWith('```');
    const isStreaming = !isClosed && !isStreamDone;

    // Detect path from code comment, text before, or code language
    let filePath = 'src/App.jsx';
    const firstLine = rawCode.trim().split('\n')[0] || '';
    const commentPathMatch = firstLine.match(/^\/\/\s*([\w/.-]+\.(?:jsx|tsx|js|ts|css|html|json))/i);
    const beforeTextMatch = textBefore.match(/(?:file|path|in)?\s*[:`*]*([a-zA-Z0-9_\-./]+\.(?:jsx|tsx|js|ts|css|html|json))[`*]*/i);

    if (commentPathMatch) {
      filePath = commentPathMatch[1].startsWith('/') ? commentPathMatch[1].substring(1) : commentPathMatch[1];
    } else if (beforeTextMatch) {
      filePath = beforeTextMatch[1].startsWith('/') ? beforeTextMatch[1].substring(1) : beforeTextMatch[1];
    } else if (lang === 'css' || rawCode.includes('{') && rawCode.includes(':') && !rawCode.includes('import ') && !rawCode.includes('export ')) {
      filePath = 'src/styles.css';
    } else if (lang === 'html') {
      filePath = 'index.html';
    } else if (lang === 'json') {
      filePath = 'package.json';
    }

    const cleanCode = rawCode.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

    if (cleanCode.trim()) {
      resultSegments.push({
        type: 'file',
        path: filePath,
        content: cleanCode,
        isStreaming
      });
      fileMap[filePath] = cleanCode;
    }

    lastIdx = blockMatch.index + blockMatch[0].length;
  }

  const textAfter = text.substring(lastIdx);
  if (textAfter.trim()) {
    resultSegments.push({ type: 'text', content: textAfter });
  }

  return resultSegments;
}

export function parseMessageSegments(rawText: string, isStreamDone: boolean = false): ParseResult {
  const segments: MessageSegment[] = [];
  const fileMap: Record<string, string> = {};
  const editsMap: Record<string, CodeEdit[]> = {};
  
  let remaining = rawText;
  
  // Regex to match either <file path="...">, <edit path="...">, <command>, or <plan>
  const tagStartRegex = /<(file\s+path=["'][^"']+["']|edit\s+path=["'][^"']+["']|command|plan)>/i;

  while (remaining.length > 0) {
    const match = remaining.match(tagStartRegex);
    if (!match) {
      let textContent = remaining;
      if (!isStreamDone) {
        // Handle incomplete tags
        const incompleteMatch = remaining.match(/<(?:file|edit|command|plan)(?:\s+path=["'][^"']*)?$/i);
        if (incompleteMatch && incompleteMatch.index !== undefined) {
          textContent = remaining.substring(0, incompleteMatch.index);
        }
      }
      
      if (textContent.trim()) {
        const extracted = extractMarkdownCodeBlocks(textContent, isStreamDone, fileMap);
        segments.push(...extracted);
      }
      break;
    }

    const textBefore = remaining.substring(0, match.index);
    if (textBefore.trim()) {
      const extracted = extractMarkdownCodeBlocks(textBefore, isStreamDone, fileMap);
      segments.push(...extracted);
    }

    const fullTag = match[0];
    const isCommand = fullTag.toLowerCase().startsWith('<command>');
    const isPlan = fullTag.toLowerCase().startsWith('<plan>');
    const isEdit = fullTag.toLowerCase().startsWith('<edit');
    
    let filePath = '';
    if (!isCommand && !isPlan) {
      const pathMatch = fullTag.match(/path=["']([^"']+)["']/i);
      filePath = pathMatch ? pathMatch[1] : 'unknown';
    }

    const afterStartTag = remaining.substring((match.index ?? 0) + match[0].length);
    let endTag = '</file>';
    if (isCommand) endTag = '</command>';
    else if (isPlan) endTag = '</plan>';
    else if (isEdit) endTag = '</edit>';
    
    const endTagIndex = afterStartTag.indexOf(endTag);

    const cleanContent = (str: string) => {
      let c = str.replace(/^\r?\n/, '');
      return c.replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/, '').replace(/\r?\n```\s*$/, '');
    };

    if (endTagIndex !== -1) {
      const content = cleanContent(afterStartTag.substring(0, endTagIndex));
      
      if (isCommand) {
        segments.push({ type: 'command', command: content, isStreaming: false });
      } else if (isPlan) {
        segments.push({ type: 'plan', content, isStreaming: false });
      } else if (isEdit) {
        const edits = parseEditPairs(content);
        segments.push({ type: 'edit', path: filePath, rawContent: content, edits, isStreaming: false });
        editsMap[filePath] = edits;
      } else {
        segments.push({ type: 'file', path: filePath, content, isStreaming: false });
        fileMap[filePath] = content;
      }
      
      remaining = afterStartTag.substring(endTagIndex + endTag.length);
    } else {
      const content = cleanContent(afterStartTag);
      
      if (isCommand) {
        segments.push({ type: 'command', command: content, isStreaming: !isStreamDone });
      } else if (isPlan) {
        segments.push({ type: 'plan', content, isStreaming: !isStreamDone });
      } else if (isEdit) {
        const edits = parseEditPairs(content);
        segments.push({ type: 'edit', path: filePath, rawContent: content, edits, isStreaming: !isStreamDone });
        editsMap[filePath] = edits;
      } else {
        segments.push({ type: 'file', path: filePath, content, isStreaming: !isStreamDone });
        fileMap[filePath] = content;
      }
      break;
    }
  }

  return { segments, fileMap, editsMap };
}
