import { useEffect, useState } from 'react';
import BrainHalfLogo from './BrainHalfLogo';
import ThemeToggle from './ThemeToggle';
import { submitEmailRequest } from '../lib/email-client';
import { ACCOUNT_PAGES } from '../seo/content';
import './AccountPage.css';

export default function AccountPage({ path }: { path: string }) {
  const title = ACCOUNT_PAGES[path];
  const reset = path === '/reset-password';
  const verify = path === '/verify-email';
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value) { setToken(value); window.history.replaceState({}, '', window.location.pathname); }
  }, []);
  return <main className="account-page"><div className="account-card">
    <header><a href="/" aria-label="BrainHalf home"><BrainHalfLogo size={38} /><strong>BrainHalf</strong></a><ThemeToggle /></header>
    <p className="studio-section-label">YOUR ACCOUNT</p><h1>{title}</h1>
    <p>{reset ? 'Choose a new password to secure your account. Existing sessions will be signed out.' : verify ? 'Confirm your email address to finish setting up your account.' : 'Enter your account email and we’ll send you a link with the next steps.'}</p>
    <noscript><p>Enable JavaScript to use this secure account form.</p></noscript>
    {notice ? <div role="status" className="account-notice">{notice}</div> : <form className="account-form" method="post" action={`/api/auth${path}`} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError('');
      if (reset && password !== confirmation) { setError('The passwords do not match.'); return; }
      setBusy(true);
      try {
        const result = await submitEmailRequest(`auth${path}`, reset || verify ? { token, ...(reset ? { password } : {}) } : { email });
        setNotice(verify ? 'Your email is verified. You can now sign in.' : reset ? 'Your password is updated. Sign in with your new password.' : result.message || 'Check your email for the next steps.');
        setToken(''); setPassword(''); setConfirmation('');
      } catch (err) { setError(err instanceof Error ? err.message : 'Please try again.'); }
      finally { setBusy(false); }
    }}>
      {!reset && !verify && <label>Email address<input type="email" name="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {reset && <><label>New password<input type="password" name="password" autoComplete="new-password" minLength={8} maxLength={512} required value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm new password<input type="password" name="confirmation" autoComplete="new-password" minLength={8} maxLength={512} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>}
      {(reset || verify) && !token && <p>Open the link from your email. If it has expired, <a href={reset ? '/forgot-password' : '/resend-verification'}>request a new link</a>.</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      <button className="landing-get-started-btn" disabled={busy || ((reset || verify) && !token)}>{busy ? 'Please wait…' : reset ? 'Update password' : verify ? 'Verify email' : 'Send email link'}</button>
    </form>}
    <nav className="account-links"><a href="/">Back to BrainHalf</a>{!verify && <a href="/resend-verification">Resend verification email</a>}<a href="/contact">Contact us</a></nav>
  </div></main>;
}
