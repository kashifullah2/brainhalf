import { describe, expect, it } from 'vitest';
import { createTypeScriptStarter, addTypeScriptBackend } from '../lib/project-starters';
import { buildSystemPrompt } from '../lib/system-prompt';

const PHANTOM_HOOKS = /\buseAuth\b|\bAuthProvider\b|\bAuthContext\b/;
const DEFINITION_PATTERN = /(?:function\s+useAuth|const\s+useAuth|export\s+(?:default\s+)?(?:function|const)\s+(?:useAuth|AuthProvider)|createContext.*Auth|AuthContext\s*=\s*createContext)/;

function detectPhantomAuthHooks(files: Record<string, string>): string[] {
  let anyDefines = false;
  const consumers: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(?:[jt]sx?)$/.test(path)) continue;
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (DEFINITION_PATTERN.test(stripped)) { anyDefines = true; break; }
    if (PHANTOM_HOOKS.test(stripped)) consumers.push(path);
  }
  return anyDefines ? [] : consumers;
}

describe('Scaffold files never reference undefined auth hooks', () => {
  it('TypeScript starter App.tsx does not reference useAuth / AuthProvider / AuthContext', () => {
    const files = createTypeScriptStarter();
    for (const [path, content] of Object.entries(files)) {
      expect(content, `${path} references a phantom auth hook`).not.toMatch(PHANTOM_HOOKS);
    }
  });

  it('full-stack starter (addTypeScriptBackend) does not reference phantom auth hooks in UI files', () => {
    const starter = createTypeScriptStarter();
    const fullStack = addTypeScriptBackend(starter);
    const uiFiles = Object.entries(fullStack).filter(([p]) => p.startsWith('/src/'));
    for (const [path, content] of uiFiles) {
      expect(content, `${path} references a phantom auth hook`).not.toMatch(PHANTOM_HOOKS);
    }
  });

  it('system prompt includes the useAuth prohibition rule', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('useAuth');
    expect(prompt).toContain('AuthProvider');
    expect(prompt).toContain('scaffold does NOT include');
  });
});

describe('Phantom auth hook detection (mirrors agent.verifyNoPhantomAuthHooks)', () => {
  it('AuthProvider defined and used in the SAME file passes (no phantom)', () => {
    const files: Record<string, string> = {
      '/src/App.tsx': [
        'import { createContext, useContext, useState } from "react";',
        'const AuthContext = createContext({ user: null });',
        'export function AuthProvider({ children }) {',
        '  const [user] = useState(null);',
        '  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;',
        '}',
        'export function useAuth() { return useContext(AuthContext); }',
        'export default function App() { return <AuthProvider><Inner /></AuthProvider>; }',
        'function Inner() { const { user } = useAuth(); return <div>{user}</div>; }',
      ].join('\n'),
    };
    expect(detectPhantomAuthHooks(files)).toEqual([]);
  });

  it('useAuth defined in one generated file and consumed in another passes', () => {
    const files: Record<string, string> = {
      '/src/hooks/useAuth.tsx': [
        'import { createContext, useContext, useState } from "react";',
        'const AuthContext = createContext({ user: null });',
        'export function AuthProvider({ children }) {',
        '  const [user] = useState(null);',
        '  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;',
        '}',
        'export function useAuth() { return useContext(AuthContext); }',
      ].join('\n'),
      '/src/App.tsx': 'import { useAuth } from "./hooks/useAuth";\nexport default function App() { const { user } = useAuth(); return <div>{user}</div>; }',
      '/src/components/Header.tsx': 'import { useAuth } from "../hooks/useAuth";\nexport default function Header() { const { user } = useAuth(); return <header>{user}</header>; }',
    };
    expect(detectPhantomAuthHooks(files)).toEqual([]);
  });

  it('useAuth/AuthProvider used with no definition triggers repair (returns consumer list)', () => {
    const files: Record<string, string> = {
      '/src/App.tsx': 'import { useAuth } from "./hooks/useAuth";\nexport default function App() { const { user } = useAuth(); return <div>{user}</div>; }',
      '/src/components/Header.tsx': 'import { useAuth } from "../hooks/useAuth";\nexport default function Header() { const { user } = useAuth(); return <header>{user}</header>; }',
      '/src/main.tsx': 'import { AuthProvider } from "./hooks/useAuth";\ncreateRoot(root).render(<AuthProvider><App /></AuthProvider>);',
    };
    const consumers = detectPhantomAuthHooks(files);
    expect(consumers.length).toBe(3);
    expect(consumers).toContain('/src/App.tsx');
    expect(consumers).toContain('/src/components/Header.tsx');
    expect(consumers).toContain('/src/main.tsx');
  });

  it('ignores non-JS/TS files', () => {
    const files: Record<string, string> = {
      '/README.md': 'The app uses useAuth from AuthProvider for authentication.',
      '/src/App.tsx': 'export default function App() { return <div>Hello</div>; }',
    };
    expect(detectPhantomAuthHooks(files)).toEqual([]);
  });

  it('ignores commented-out references', () => {
    const files: Record<string, string> = {
      '/src/App.tsx': '// import { useAuth } from "./hooks/useAuth";\n/* useAuth() */\nexport default function App() { return <div>Hello</div>; }',
    };
    expect(detectPhantomAuthHooks(files)).toEqual([]);
  });
});
