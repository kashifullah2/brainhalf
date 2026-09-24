import { useState } from 'react';
import { submitEmailRequest } from '../lib/email-client';
import './AccountPage.css';

export default function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (sent) return <div className="account-notice" role="status">Your message has been sent. Thank you for contacting BrainHalf.</div>;
  return <form className="account-form contact-form" method="post" action="/api/contact" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true); setError('');
    try { await submitEmailRequest('contact', values); setSent(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setBusy(false); }
  }}>
    <h2>Send us a message</h2>
    <noscript><p>Enable JavaScript to send your message.</p></noscript>
    <label>Your name<input name="name" autoComplete="name" required maxLength={100} /></label>
    <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
    <label>How can we help?<textarea name="message" rows={6} required minLength={10} maxLength={5000} /></label>
    <label className="contact-trap" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <p>Your message and email address are used to respond to your request. Please leave passwords and API keys out of your message.</p>
    {error && <p role="alert" className="account-error">{error}</p>}
    <button className="landing-get-started-btn" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
  </form>;
}
