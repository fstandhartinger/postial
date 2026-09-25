// Static product illustration for the landing hero: a client review link and the post's
// publishing timeline, drawn in HTML/CSS so it costs no image bytes and follows the theme.
// Sample content only; the figcaption says so, because nothing here is a real customer.
const networks = [
  { name: 'Bluesky', tone: 'bluesky' },
  { name: 'Mastodon', tone: 'mastodon' },
  { name: 'Telegram', tone: 'telegram' },
] as const;

const timeline = [
  { label: 'Approved by client', meta: 'Tue 09:12 · no login', state: 'done' },
  { label: 'Scheduled', meta: 'Thu 09:00 · Europe/Berlin', state: 'done' },
  { label: 'Telegram: temporary error, retrying', meta: 'Thu 09:00 · attempt 2', state: 'retry' },
  { label: 'Published on 3 networks', meta: 'Thu 09:01', state: 'live' },
] as const;

export function HeroVisual() {
  return <figure className="hero-visual">
    <div className="hv-stage" aria-hidden="true">
      <div className="hv-card hv-review">
        <div className="hv-bar"><span className="hv-dots"><i /><i /><i /></span><span className="hv-url">postial.co/r/•••••••</span></div>
        <div className="hv-body">
          <div className="hv-brand"><span className="hv-avatar">NC</span><span><b>Nordlicht Café</b><small>Review requested by Jonas · Studio Hafen</small></span></div>
          <p className="hv-post">Our autumn menu is here: pumpkin soup, chestnut cake and the first mulled wine of the season. Open daily from 8.</p>
          <div className="hv-media"><span className="hv-sun" /><span className="hv-hill hv-hill-a" /><span className="hv-hill hv-hill-b" /></div>
          <div className="hv-networks">{networks.map(network => <span key={network.name} className={`hv-chip hv-${network.tone}`}>{network.name}</span>)}</div>
          <div className="hv-actions"><span className="hv-btn">Request changes</span><span className="hv-btn hv-approve"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="m5 12 5 5 9-10" /></svg>Approved</span></div>
        </div>
      </div>
      <div className="hv-card hv-timeline">
        <p className="hv-kicker">Post status</p>
        <ol>{timeline.map(step => <li key={step.label} className={`hv-step hv-${step.state}`}><span className="hv-node" /><span><b>{step.label}</b><small>{step.meta}</small></span></li>)}</ol>
      </div>
    </div>
    <figcaption className="hv-caption">Illustration with sample content: a client approves through a review link, then Postial publishes and shows each retry.</figcaption>
  </figure>;
}
