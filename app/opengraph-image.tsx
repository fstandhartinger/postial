import { ImageResponse } from 'next/og';

export const alt = 'Postial — scheduling and client approvals for social agencies';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

const chip = { display: 'flex', padding: '10px 22px', borderRadius: 999, border: '1px solid #2b3a33', color: '#c8d5ce', fontSize: 24 } as const;

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ background: 'linear-gradient(135deg, #07110d 0%, #0b1f17 60%, #0f3325 100%)', color: '#f1f5f3', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 88px', width: '100%', height: '100%', fontFamily: 'Arial' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#10b981" /><path d="M20 18h20a8 8 0 0 1 0 16H28a8 8 0 0 0 0 16h20" fill="none" stroke="#04130d" strokeWidth="6" strokeLinecap="round" /></svg>
      <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-1.5px' }}>Postial</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-3px', lineHeight: 1.05 }}>Client posts, approved</div>
      <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-3px', lineHeight: 1.05, color: '#34d399' }}>and published on time.</div>
      <div style={{ fontSize: 30, marginTop: 28, color: '#a9b8b0' }}>Scheduling and login-free client approvals for social agencies.</div>
    </div>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={chip}>Bluesky</div><div style={chip}>Mastodon</div><div style={chip}>Telegram</div>
      <div style={{ display: 'flex', marginLeft: 'auto', color: '#34d399', fontSize: 26 }}>postial.co</div>
    </div>
  </div>, { ...size });
}
