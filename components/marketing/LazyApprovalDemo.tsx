'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
const Demo = dynamic(() => import('./ApprovalDemo').then(m => m.ApprovalDemo), {
  ssr: false,
  loading: () => <p role="status">Loading interactive demo…</p>,
});
export function LazyApprovalDemo() {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin:'200px'});
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} style={{minHeight:420}}>
    {visible ? <Demo /> : <button type="button" className="secondary" onClick={() => setVisible(true)}>Load interactive demo</button>}
  </div>;
}
