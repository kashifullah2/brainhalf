export type MessageSegment = 
  | { type: 'text'; content: string }
  | { type: 'file'; path: string; content: string; isStreaming: boolean }
  | { type: 'command'; command: string; isStreaming: boolean }
  | { type: 'plan'; content: string; isStreaming: boolean };

export interface ParseResult {
  segments: MessageSegment[];
  fileMap: Record<string, string>;
}

export function parseMessageSegments(rawText: string, isStreamDone: boolean = false): ParseResult {
  const segments: MessageSegment[] = [];
  const fileMap: Record<string, string> = {};
  
  let remaining = rawText;
  
  // Regex to match either <file path="...">, <command>, or <plan>
  const tagStartRegex = /<(file\s+path=["'][^"']+["']|command|plan)>/i;

  while (remaining.length > 0) {
    const match = remaining.match(tagStartRegex);
    if (!match) {
      let textContent = remaining;
      if (!isStreamDone) {
        // Handle incomplete tags
        const incompleteMatch = remaining.match(/<(?:file|command|plan)(?:\s+path=["'][^"']*)?$/i);
        if (incompleteMatch && incompleteMatch.index !== undefined) {
          textContent = remaining.substring(0, incompleteMatch.index);
        }
      }
      
      if (textContent.trim()) {
        segments.push({ type: 'text', content: textContent });
      }
      break;
    }

    const textBefore = remaining.substring(0, match.index);
    if (textBefore.trim()) {
      segments.push({ type: 'text', content: textBefore });
    }

    const fullTag = match[0];
    const isCommand = fullTag.toLowerCase().startsWith('<command>');
    const isPlan = fullTag.toLowerCase().startsWith('<plan>');
    
    let filePath = '';
    if (!isCommand && !isPlan) {
      const pathMatch = fullTag.match(/path=["']([^"']+)["']/i);
      filePath = pathMatch ? pathMatch[1] : 'unknown';
    }

    const afterStartTag = remaining.substring((match.index ?? 0) + match[0].length);
    let endTag = '</file>';
    if (isCommand) endTag = '</command>';
    else if (isPlan) endTag = '</plan>';
    
    const endTagIndex = afterStartTag.indexOf(endTag);

    if (endTagIndex !== -1) {
      const content = afterStartTag.substring(0, endTagIndex).replace(/^\r?\n/, '');
      
      if (isCommand) {
        segments.push({ type: 'command', command: content, isStreaming: false });
      } else if (isPlan) {
        segments.push({ type: 'plan', content, isStreaming: false });
      } else {
        segments.push({ type: 'file', path: filePath, content, isStreaming: false });
        fileMap[filePath] = content;
      }
      
      remaining = afterStartTag.substring(endTagIndex + endTag.length);
    } else {
      const content = afterStartTag.replace(/^\r?\n/, '');
      
      if (isCommand) {
        segments.push({ type: 'command', command: content, isStreaming: !isStreamDone });
      } else if (isPlan) {
        segments.push({ type: 'plan', content, isStreaming: !isStreamDone });
      } else {
        segments.push({ type: 'file', path: filePath, content, isStreaming: !isStreamDone });
        fileMap[filePath] = content;
      }
      break;
    }
  }

  return { segments, fileMap };
}
