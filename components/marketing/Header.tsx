'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
export function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return <header className="site-header"><nav className="container header-inner" aria-label="Main navigation" onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <Link href="/" className="wordmark" aria-label="SocialMint home">Social<span>Mint</span></Link>
    <button ref={toggle} type="button" className="menu-toggle secondary" aria-expanded={open} aria-controls="navigation" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
    <div id="navigation" className={`navigation ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)}>
      <Link href="/#features">Features</Link><Link href="/#demo">Demo</Link><Link href="/pricing">Pricing</Link><Link href="/#faq">FAQ</Link><Link href="/login">Log in</Link><Link className="primary" href="/login">Start free</Link>
    </div>
  </nav></header>;
}
