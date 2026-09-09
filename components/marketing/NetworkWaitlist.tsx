'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
export function NetworkWaitlist({ network, name, source }: { network: string; name: string; source: 'pricing' | 'roadmap' }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  if (done) return <p role="status">Saved. We’ll email you once, when {name} is live.</p>;
  return <div>{!open ? <button className="secondary" type="button" aria-expanded={false} onClick={() => setOpen(true)}>Notify me<span className="sr-only"> about {name}</span></button> : <form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    const email = new FormData(event.currentTarget).get('email');
    try {
      const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ network, email, source }) });
      if (response.ok) setDone(true);
      else setMessage(response.status === 429 ? 'Too many signups. Please try again in an hour.' : response.status === 422 ? 'Enter a valid email address.' : 'Could not save your request. Please try again.');
    } catch { setMessage('Could not connect. Please try again.'); }
    finally { setBusy(false); }
  }}><label htmlFor={id}>Email for {name}</label><input className="w-full rounded border p-3 my-2" id={id} type="email" name="email" autoComplete="email" required maxLength={254} /><p className="note">We&apos;ll email you once, when it&apos;s live. By signing up you agree to this notification. <Link href="/privacy">Privacy Policy</Link>. You can withdraw by contacting us.</p><button className="secondary" disabled={busy}>{busy ? 'Saving…' : 'Notify me'}</button><p role="status">{message}</p></form>}</div>;
}
