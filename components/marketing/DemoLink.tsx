'use client';
export function DemoLink({ children }: { children: React.ReactNode }) {
  return <a className="secondary" href="#demo" onClick={event => {
    event.preventDefault();
    window.history.pushState(null, '', '#demo');
    document.getElementById('demo')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    document.getElementById('demo-heading')?.focus({ preventScroll: true });
  }}>{children}</a>;
}
