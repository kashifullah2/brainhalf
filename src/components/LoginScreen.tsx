import React, { useState, useEffect, useRef } from 'react';
import { BrainHalfLogo } from './BrainHalfLogo';
import { login, signup, type SessionUser } from '../lib/auth-client';

interface LoginScreenProps {
  onAuthenticated: (user: SessionUser) => void;
}

type Mode = 'login' | 'signup';

/**
 * Full-screen auth gate. Shown by App.tsx whenever no valid server-side
 * session exists. All access to the studio requires it — there is no
 * anonymous mode.
 */
const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const user = mode === 'login' ? await login(trimmed, password) : await signup(trimmed, password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  return (
    <div
      className="login-screen"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(120% 100% at 50% 0%, #14161f 0%, #0b0c11 55%, #08090d 100%)',
        padding: '24px',
        zIndex: 99999,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '392px',
          background: 'rgba(255, 255, 255, 0.025)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '32px 28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '26px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '11px',
              background: 'rgba(45, 212, 191, 0.1)',
              border: '1px solid rgba(45, 212, 191, 0.22)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <BrainHalfLogo size={22} strokeWidth={1.75} color="#2dd4bf" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--font-brand)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.3px',
                color: 'var(--text-primary)',
              }}
            >
              BrainHalf
            </h1>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: '12.5px',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              {mode === 'login' ? 'Sign in to your studio' : 'Create your studio account'}
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            gap: '3px',
            padding: '3px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '8px',
            marginBottom: '20px',
          }}
          role="tablist"
          aria-label="Authentication mode"
        >
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                padding: '7px 0',
                border: 'none',
                borderRadius: '6px',
                background: mode === m ? 'rgba(255, 255, 255, 0.09)' : 'transparent',
                color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label htmlFor="login-email" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>Email</span>
            <input
              id="login-email"
              ref={emailRef}
              type="email"
              aria-label="Email Address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              spellCheck={false}
              required
              style={inputStyle}
            />
          </label>

          <label htmlFor="login-password" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>Password</span>
            <input
              id="login-password"
              type="password"
              aria-label="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              style={inputStyle}
            />
          </label>

          {error && (
            <div
              role="alert"
              style={{
                fontSize: '12px',
                color: 'var(--color-error)',
                background: 'var(--color-error-bg)',
                border: '1px solid var(--color-error-border)',
                borderRadius: '6px',
                padding: '8px 10px',
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%',
              padding: '9px 0',
              border: 'none',
              borderRadius: '7px',
              background: busy ? 'rgba(255,255,255,0.12)' : '#ffffff',
              color: '#09090b',
              fontSize: '13px',
              fontWeight: 650,
              cursor: busy ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease, transform 0.08s ease',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p
          style={{
            margin: '18px 0 0',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Projects are tied to your account. Your password is hashed with PBKDF2
          and never stored in plaintext.
        </p>
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  background: 'rgba(0, 0, 0, 0.28)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '7px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

export default LoginScreen;
