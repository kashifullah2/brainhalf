import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from './lib/api';
import type { Item, User } from '../shared/api';
import brandImage from './assets/uploads/bc11a38c-f227-4b63-8388-33c6b3fc8c67.js';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [title, setTitle] = useState(''); const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [editTitle, setEditTitle] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      try { const account = await api.me(); const saved = await api.items(); if (active) { setUser(account); setItems(saved); } }
      catch (cause) { if (active && !(cause instanceof ApiRequestError && cause.status === 401)) setError(cause instanceof Error ? cause.message : 'Unable to load your notes.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault(); void perform(async () => {
      const account = await (mode === 'register' ? api.register(email, password) : api.login(email, password));
      const saved = await api.items(); setUser(account); setItems(saved); setPassword(''); setNotice('You are signed in.');
    });
  }
  const shown = items.filter(item => item.title.toLowerCase().includes(search.toLowerCase()));
  return <main className="shell">
    <header className="masthead"><div className="brand"><img src={brandImage} alt="BrainHalf" width="36" height="36" /><span>Harbor<span className="brand-note">A personal notes workspace</span></span></div>{user && <button disabled={busy} onClick={() => void perform(async () => { await api.logout(); setUser(null); setItems([]); setSearch(''); setTitle(''); setEditing(null); setNotice('Signed out.'); })}>Sign out</button>}</header>
    <section className="intro"><p className="eyebrow">A LITTLE ROOM TO THINK</p><h1>Keep what matters.</h1><p>Capture an idea. Make a plan. Come back when you’re ready.</p></section>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p role="status">Opening your workspace…</p> : !user ? <section className="card auth-card"><h2>{mode === 'register' ? 'Make yourself a space' : 'Welcome back'}</h2><p>Your notes belong to your account.</p><form onSubmit={authenticate}><fieldset disabled={busy}><label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" minLength={12} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required value={password} onChange={event => setPassword(event.target.value)} aria-describedby="password-help" /></label><small id="password-help">Use at least 12 characters.</small><button className="primary" type="submit">{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button></fieldset></form><button className="text-button" disabled={busy} onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section> : <section className="card"><div className="section-title"><div><h2>Your notes</h2><p>{user.email}</p></div><span className="count">{items.length} {items.length === 1 ? 'note' : 'notes'}</span></div><form className="new-note" onSubmit={event => { event.preventDefault(); void perform(async () => { const item = await api.createItem(title); setItems(current => [...current, item]); setTitle(''); setNotice('Note saved.'); }); }}><label className="grow">A new thought<input placeholder="What would you like to remember?" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} required disabled={busy} /></label><button className="primary" type="submit" disabled={busy || !title.trim()}>Add note</button></form><label className="search">Search notes<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a thought…" /></label>{shown.length ? <ul className="notes">{shown.map(item => <li key={item.id}>{editing === item.id ? <form className="edit-note" onSubmit={event => { event.preventDefault(); void perform(async () => { const changed = await api.updateItem(item.id, editTitle); setItems(current => current.map(value => value.id === item.id ? changed : value)); setEditing(null); setNotice('Note updated.'); }); }}><label className="grow">Edit note<input required maxLength={200} value={editTitle} disabled={busy} onChange={event => setEditTitle(event.target.value)} /></label><button type="submit" disabled={busy || !editTitle.trim()}>Save</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></form> : <><div className="note-copy"><p>{item.title}</p><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleDateString()}</time></div><div className="note-actions"><button disabled={busy} aria-label={'Edit ' + item.title} onClick={() => { setEditing(item.id); setEditTitle(item.title); }}>Edit</button><button disabled={busy} aria-label={'Delete ' + item.title} onClick={() => void perform(async () => { await api.deleteItem(item.id); setItems(current => current.filter(value => value.id !== item.id)); setNotice('Note deleted.'); })}>Delete</button></div></>}</li>)}</ul> : <div className="empty"><span aria-hidden="true">✳</span><h3>{search ? 'No matching notes' : 'A fresh page'}</h3><p>{search ? 'Try another search.' : 'Add your first thought above.'}</p></div>}</section>}
    <footer>Made with BrainHalf <span>·</span> Your ideas, in good company.</footer>
  </main>;
}
