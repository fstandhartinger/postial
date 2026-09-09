'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
export function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return <header className="site-header"><nav className="container header-inner" aria-label="Main navigation" onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <Link prefetch={false} href="/" className="wordmark" aria-label="SocialMint home">Social<span>Mint</span></Link>
    <button ref={toggle} type="button" className="menu-toggle secondary" aria-expanded={open} aria-controls="navigation" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
    <div id="navigation" className={`navigation ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)}>
      <Link prefetch={false} href="/#features">Features</Link><Link prefetch={false} href="/#demo">Demo</Link><Link prefetch={false} href="/pricing">Pricing</Link><Link prefetch={false} href="/#faq">FAQ</Link><Link prefetch={false} href="/login">Log in</Link><Link prefetch={false} className="primary" href="/login">Start free</Link>
    </div>
  </nav></header>;
}
