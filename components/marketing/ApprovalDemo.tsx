'use client';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
type State = 'S0' | 'S1' | 'S2' | 'S2R' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7';
const states: Record<State, { status: string; explanation: string; entry?: string }> = {
  S0: { status: 'Awaiting approval', explanation: 'Review this sample post as the client.', entry: 'Draft ready for review.' },
  S1: { status: 'Awaiting approval', explanation: 'Tell the agency what you would change.' },
  S2: { status: 'Changes requested', explanation: 'The agency can revise this draft before you approve it.', entry: 'Client requested changes.' },
  S2R: { status: 'Awaiting approval', explanation: 'The sample revision is ready for your review.', entry: 'Agency updated the sample draft.' },
  S3: { status: 'Approved', explanation: 'Approved by the client. Ready to schedule.', entry: 'Client approved this version.' },
  S4: { status: 'Scheduled', explanation: 'The post is queued for the sample publishing time.', entry: 'Scheduled for September 18 at 10:00 AM UTC.' },
  S5: { status: 'Retry pending', explanation: 'The network is temporarily unavailable. Your post has not been published. We can try again.', entry: 'Attempt 1 failed: temporary network error. Retry pending.' },
  S6: { status: 'Retrying', explanation: 'Retry attempt 2 is in progress in this demo.', entry: 'Attempt 2 started.' },
  S7: { status: 'Published', explanation: 'The second attempt succeeded. This is a simulated result; nothing was published.', entry: 'Attempt 2 succeeded. Published in the demo.' },
};
const original = 'A fresh look for your next chapter. Explore our new studio portfolio this Friday.';
const revision = 'A fresh look for your next chapter. Explore our new studio portfolio this Monday.';
const defaultFeedback = 'Please change Friday to Monday.';
type Activity = { state: State; text: string };
export function ApprovalDemo({ notice }: { notice?: React.ReactNode }) {
  const [state, setState] = useState<State>('S0');
  const [revised, setRevised] = useState(false);
  const [approvedVersion, setApprovedVersion] = useState<string | null>(null);
  const [draft, setDraft] = useState(defaultFeedback);
  const [feedback, setFeedback] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [history, setHistory] = useState<Activity[]>([{ state: 'S0', text: states.S0.entry! }]);
  const heading = useRef<HTMLHeadingElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const shouldFocus = useRef(false);
  const currentState = useRef<State>('S0');
  useLayoutEffect(() => { if (shouldFocus.current) { heading.current?.focus(); shouldFocus.current = false; } });
  function enter(next: State, addEntry = true) {
    if (currentState.current === next) return;
    currentState.current = next;
    shouldFocus.current = true;
    setState(next);
    const entry = states[next].entry;
    if (addEntry && entry) setHistory(previous => [...previous, { state: next, text: entry }]);
  }
  function reset() {
    setRevised(false); setApprovedVersion(null); setDraft(defaultFeedback); setFeedback(''); setInvalid(false);
    setHistory([{ state: 'S0', text: states.S0.entry! }]);
    currentState.current = 'S0'; setState('S0'); shouldFocus.current = true;
  }
  function approve() { setApprovedVersion(revised ? revision : original); enter('S3'); }
  function request() { setDraft(defaultFeedback); setInvalid(false); enter('S1'); }
  const warning = state === 'S5' || state === 'S6';
  return <div className="demo"><p className="demo-disclosure">Interactive demo · Sample content · Nothing is sent or published.</p><div className="panel demo-card"><div className="demo-brand"><strong>Sample brand: Maple Studio</strong><span className="badge">Bluesky</span></div>
    <p className="note">Post preview</p><p className="post-text">{approvedVersion ?? (revised ? revision : original)}</p>
    <div className="portfolio" role="img" aria-label="Sample portfolio preview"><svg aria-hidden="true" viewBox="0 0 160 90"><rect x="14" y="14" width="75" height="62" rx="8"/><circle cx="110" cy="38" r="23"/><path d="M85 76 119 48 146 76Z"/></svg><span>Maple Studio / New portfolio</span></div>
    <dl className="schedule"><dt>Scheduled for</dt><dd>Friday, September 18, 2026 · 10:00 AM UTC</dd></dl>
    {revised && <p className="note">Preset revision: Friday → Monday.</p>}
    <div className={`demo-status ${warning ? 'warning' : ''}`}><h3 ref={heading} tabIndex={-1}>{warning && <span aria-hidden="true">⚠ </span>}{states[state].status}</h3><p>{states[state].explanation}</p>{state === 'S5' && <p><strong>Attempt 1 failed</strong></p>}{state === 'S6' && <p><strong>Attempt 2 in progress</strong></p>}</div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{states[state].status}</p>
    {feedback && <div className="feedback"><strong>Client feedback</strong><p>{feedback}</p></div>}
    {state === 'S1' ? <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) { setInvalid(true); textarea.current?.focus(); return; } setFeedback(draft.trim()); setInvalid(false); enter('S2'); }}><label htmlFor="requested-changes">Requested changes</label><textarea ref={textarea} id="requested-changes" maxLength={240} placeholder="Example: Replace Friday with Monday." value={draft} onChange={event => setDraft(event.target.value)} aria-invalid={invalid} aria-describedby={`feedback-help${invalid ? ' feedback-error' : ''}`} /><p className="note" id="feedback-help">Demo only. Do not enter personal or confidential information.</p>{invalid && <p id="feedback-error" role="alert">Enter a change request to continue.</p>}<div className="actions"><button className="primary" type="submit">Send request</button><button className="secondary" type="button" onClick={() => { setDraft(defaultFeedback); setInvalid(false); enter(revised ? 'S2R' : 'S0', false); }}>Cancel</button></div></form> : <div className="actions">
      {(state === 'S0' || state === 'S2R') && <><button type="button" className="primary" onClick={approve}>Approve</button><button type="button" className="secondary" onClick={request}>Request changes</button></>}
      {state === 'S2' && <><button type="button" className="primary" onClick={() => { setRevised(true); setApprovedVersion(null); enter('S2R'); }}>Preview revision</button><p className="note">This demo applies a preset revision, regardless of your feedback.</p></>}
      {state === 'S3' && <button type="button" className="primary" onClick={() => enter('S4')}>Schedule post</button>}
      {state === 'S4' && <button type="button" className="primary" onClick={() => enter('S5')}>Simulate publish</button>}
      {state === 'S5' && <button type="button" className="primary" onClick={() => enter('S6')}>Run simulated retry</button>}
      {state === 'S6' && <button type="button" className="primary" onClick={() => enter('S7')}>Show retry result</button>}
      {state === 'S7' && <button type="button" className="primary" onClick={() => { setHistory(previous => previous.filter(entry => !['S4', 'S5', 'S6', 'S7'].includes(entry.state))); enter('S4'); }}>Replay publishing</button>}
    </div>}
    <div className="activity"><h4>Demo activity</h4><ol>{history.map((entry, index) => <li key={index} className={entry.state === 'S5' ? 'failed' : ''}>{entry.text}</li>)}</ol></div><button type="button" className="secondary" onClick={reset}>Reset demo</button>
  </div><div className="demo-signup"><Link prefetch={false} className="primary" href="/login?plan=agency">Start free — no card needed</Link>{notice}<p className="note">Client approval links are included with Agency.</p></div></div>;
}
