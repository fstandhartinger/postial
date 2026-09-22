'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
const Demo = dynamic(() => import('./ApprovalDemo').then(m => m.ApprovalDemo), {
  ssr: false,
  loading: () => <p role="status">Loading interactive demo…</p>,
});
export function LazyApprovalDemo({ notice }: { notice?: React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin:'200px'});
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className="demo-lazy">
    {visible ? <Demo notice={notice} /> : <div className="panel demo-placeholder">
      <span className="badge">Interactive preview</span>
      <h3>See a client approval from request to publish</h3>
      <p>Review a sample post, request a change, approve it, and walk through a simulated retry. Nothing is sent or published.</p>
      <button type="button" className="secondary" onClick={() => setVisible(true)}>Open interactive demo</button>
    </div>}
  </div>;
}
