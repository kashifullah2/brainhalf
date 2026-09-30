import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, X, Eye, EyeOff } from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import { login, signup, startGoogleSignIn, AuthError, type SessionUser } from '../lib/auth-client';
import { useModalFocus } from '../lib/use-modal-focus';
import ThemeToggle from './ThemeToggle';
import './LoginScreen.css';

interface LoginScreenProps {
  onAuthenticated: (user: SessionUser) => void;
  onClose?: () => void;
  onGoogleStart?: () => void;
  initialMode?: 'login' | 'signup';
  initialError?: string | null;
}
type Mode = 'login' | 'signup';

function GoogleMark() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.35-2.59Z" />
    <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.35 2.59A6 6 0 0 1 12 5.95Z" />
  </svg>;
}

export default function LoginScreen({ onAuthenticated, onClose, onGoogleStart, initialMode = 'login', initialError }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError || null);
  const [notice, setNotice] = useState('');
  // True only right after a sign-in attempt failed with EMAIL_VERIFICATION_REQUIRED:
  // the resend link is relevant then, and only then.
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus(true, onClose);
  useEffect(() => { emailRef.current?.focus(); }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setVerificationRequired(false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setBusy('email');
    try {
      const result = await (mode === 'login' ? login(email.trim(), password) : signup(email.trim(), password));
      if ('verificationRequired' in result) { setNotice(result.message); setMode('login'); setPassword(''); }
      else onAuthenticated(result);
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setVerificationRequired(err instanceof AuthError && err.code === 'EMAIL_VERIFICATION_REQUIRED');
    }
    finally { setBusy(null); }
  };
  const handleGoogle = async () => {
    if (busy) return;
    setBusy('google'); setError(null);
    try { onGoogleStart?.(); await startGoogleSignIn(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Google sign-in could not start. Please try again.'); setBusy(null); }
  };
  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Enter your email address first.'); return; }
    if (busy) return;
    setBusy('email'); setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: trimmed }) });
      const body = await res.json().catch(() => ({}));
      setNotice(body.message || 'If that account exists, a reset link has been sent.');
    } catch { setNotice('If that account exists, a reset link has been sent.'); }
    finally { setBusy(null); }
  };
  const handleResendVerification = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Enter your email address first.'); return; }
    if (busy) return;
    setBusy('email'); setError(null);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: trimmed }) });
      const body = await res.json().catch(() => ({}));
      setNotice(body.message || 'If that account exists, a verification email has been sent.');
    } catch { setNotice('If that account exists, a verification email has been sent.'); }
    finally { setBusy(null); }
  };

  return <div className={`login-screen ${onClose ? 'is-modal' : 'is-page'}`} role="dialog" aria-modal="true" aria-labelledby="login-title"
    ref={dialogRef} tabIndex={-1} onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div className="studio-auth-card">
      <div className="studio-auth-topline">
        <div className="studio-auth-brand"><BrainHalfLogo size={24} strokeWidth={1.6} color="currentColor" /><span>BrainHalf</span></div>
        <div className="studio-auth-topline-actions">
          <ThemeToggle />
          {onClose && <button type="button" className="studio-auth-close" onClick={onClose} aria-label="Close"><X size={18} /></button>}
        </div>
      </div>
      <div className="studio-auth-heading">
        <h1 id="login-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>{mode === 'login' ? 'Sign in to keep working on your app' : 'Start making your app for free'}</p>
      </div>
      <div className="studio-auth-tabs" role="tablist" aria-label="Authentication mode">
        {(['login', 'signup'] as Mode[]).map((item, index) => <button type="button" key={item} id={`auth-tab-${item}`} role="tab" aria-controls="auth-panel" aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} disabled={!!busy}
          onClick={() => { setMode(item); setError(null); setVerificationRequired(false); setShowPassword(false); }} onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); const next = event.key === 'Home' ? 'login' : event.key === 'End' ? 'signup' : index === 0 ? 'signup' : 'login';
              setMode(next); setError(null); setVerificationRequired(false); setShowPassword(false); document.getElementById(`auth-tab-${next}`)?.focus();
            }
          }}>{item === 'login' ? 'Sign in' : 'Sign up'}</button>)}
      </div>
      <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
        <button type="button" className="studio-google-button" disabled={!!busy} onClick={() => void handleGoogle()}><GoogleMark />{busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</button>
        <div className="studio-auth-divider"><span>or continue with email</span></div>
        <form onSubmit={handleSubmit} noValidate className="studio-auth-form" aria-busy={!!busy}>
          <label htmlFor="login-email">Email address<input id="login-email" ref={emailRef} type="email" aria-label="Email Address" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" spellCheck={false} required disabled={!!busy} /></label>
          <label htmlFor="login-password">
            <span className="studio-auth-labelrow">
              <span>Password</span>
              {mode === 'login' && <button type="button" className="studio-auth-textlink" disabled={!!busy} onClick={() => void handleForgotPassword()}>Forgot password?</button>}
            </span>
            <span className="studio-auth-passwordwrap">
              <input id="login-password" type={showPassword ? 'text' : 'password'} aria-label="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'} required minLength={8} disabled={!!busy} />
              <button type="button" className="studio-auth-peek" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={!!busy} onClick={() => setShowPassword(value => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          {error && <div className="studio-auth-error" role="alert">{error}</div>}
          {notice && <div className="account-notice" role="status">{notice}</div>}
          <button type="submit" className="studio-auth-submit" disabled={!!busy}>{busy === 'email' ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={17} /></button>
          {mode === 'login' && verificationRequired && <div className="studio-auth-resend"><button type="button" className="studio-auth-textlink" disabled={!!busy} onClick={() => void handleResendVerification()}>Resend verification email</button></div>}
        </form>
      </div>
    </div>
  </div>;
}
