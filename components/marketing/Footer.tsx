import Link from 'next/link';
import { words } from './copy';
export function Footer() {
  return <footer className="site-footer"><div className="container"><div className="footer-grid"><div><Link href="/" className="wordmark">Social<span>Mint</span></Link><p>{words('Footer', 'Description')}</p><p>Made in Passau, Germany</p></div><nav aria-label="Product"><Link href="/#features">Features</Link><Link href="/#demo">Interactive demo</Link><Link href="/pricing">Pricing</Link></nav><nav aria-label="Legal"><Link href="/impressum">Impressum</Link><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link><a href="mailto:info@productivity-boost.com">Contact</a></nav></div><p className="note copyright">{words('Footer', 'Copyright')}</p></div></footer>;
}
