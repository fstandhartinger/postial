"use client";
import { useState } from 'react';
import {useBrowserClock} from './browser-clock';
export function TimezoneSelect() {
  const [chosen, setZone] = useState(''), [search, setSearch] = useState('');
  const time=useBrowserClock(), now=time ? new Date(time):null;
  const browser=time ? Intl.DateTimeFormat().resolvedOptions().timeZone:'UTC';
  const zone=chosen || browser;
  const zones=[...new Set(['UTC',browser,...Intl.supportedValuesOf('timeZone')])].sort();
  return <fieldset className="space-y-2"><legend>Timezone</legend><label className="block">Search city or timezone<input type="search" value={search} onChange={e => setSearch(e.target.value)} className="block w-full rounded border p-3" /></label><label className="block">Select timezone<select name="timezone" value={zone} onChange={e => setZone(e.target.value)} className="block w-full rounded border p-3">{zones.filter(z => z === zone || z.toLowerCase().replaceAll('_',' ').includes(search.toLowerCase())).map(z => <option key={z} value={z}>{z.split('/').at(-1)?.replaceAll('_',' ')} — {z}</option>)}</select></label><p className="text-sm">Suggested from your browser. Current local time: {now ? now.toLocaleString('en-GB', {timeZone:zone}) : 'Loading…'} ({zone})</p></fieldset>;
}
