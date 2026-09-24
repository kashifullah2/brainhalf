import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from './lib/api';
import type { Item, User } from '../shared/api';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.me().then(async account => {
      const records = await api.items();
      if (active) { setUser(account); setItems(records); }
    }).catch(cause => {
      if (active && !(cause instanceof ApiRequestError && cause.status === 401)) setError(cause instanceof Error ? cause.message : 'Could not load your account');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please retry.'); }
    finally { setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const account = await (registering ? api.register(email, password) : api.login(email, password));
      const records = await api.items();
      setUser(account); setItems(records); setPassword('');
    });
  }
  if (loading) return <main className="app"><p role="status">Loading your workspace…</p></main>;
  return <main className="app">
    <header><div><p className="eyebrow">YOUR WORKSPACE</p><h1>{user ? 'Your items' : 'Welcome'}</h1></div>{user && <button disabled={busy} onClick={() => void perform(async () => { await api.logout(); setUser(null); setItems([]); })}>Sign out</button>}</header>
    {error && <p role="alert" className="error">{error}</p>}
    {user ? <>
      <p>Signed in as {user.email}</p>
      <form onSubmit={event => { event.preventDefault(); void perform(async () => { const created = await api.createItem(title); setItems(previous => [...previous, created]); setTitle(''); }); }}>
        <label htmlFor="title">New item</label><div className="row"><input id="title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /><button disabled={busy || !title.trim()}>Add item</button></div>
      </form>
      {items.length === 0 ? <p>No items yet. Add your first one above.</p> : <ul>{items.map(item => <li key={item.id}><span>{item.title}</span>{deleting === item.id ? <div className="row"><button disabled={busy} onClick={() => void perform(async () => { await api.deleteItem(item.id); setItems(previous => previous.filter(record => record.id !== item.id)); setDeleting(null); })}>Confirm delete</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div> : <button disabled={busy} onClick={() => setDeleting(item.id)}>Delete</button>}</li>)}</ul>}
    </> : <form onSubmit={authenticate}>
      <h2>{registering ? 'Create an account' : 'Sign in'}</h2>
      <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password">Password</label><input id="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
      <p>Use 12–128 characters.</p><button disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Already have an account? Sign in' : 'Need an account? Register'}</button>
    </form>}
    {busy && <p role="status">Saving your changes…</p>}
  </main>;
}
