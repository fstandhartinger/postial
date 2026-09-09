import { ImageResponse } from 'next/og';

export const alt = 'Postial — scheduling and client approvals for social agencies';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ background: '#d1fae5', color: '#064e3b', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '72px 90px', width: '100%', height: '100%', fontFamily: 'Arial' }}><div style={{ fontSize: 76, fontWeight: 700, letterSpacing: '-3px' }}>Postial</div><div style={{ fontSize: 38, marginTop: 28 }}>Scheduling and client approvals for social agencies</div><div style={{ color: '#047857', fontSize: 24, marginTop: 54 }}>postial.co</div></div>, { ...size });
}
