import { auth } from '@/auth';
import { funnelReport, isAdminEmail, isOwnReferrer, FUNNEL_EVENTS, CLIENT_CLASSES, FUNNEL_SUCCESS_EVENTS, FUNNEL_FAILURE_EVENTS } from '@/lib/funnel';
import { notFound } from 'next/navigation';

export default async function FunnelPage() {
  const session = await auth(), email = session?.user?.email?.trim().toLowerCase();
  if (!isAdminEmail(email)) notFound();
  const report = await funnelReport(30);
  return <section><h1 className="text-3xl font-semibold">Funnel</h1><p className="text-sm text-zinc-600">Last {report.days} days, from {report.since}</p>
    <h2 className="mt-6 text-xl font-semibold">Success funnel</h2><table className="mt-2"><tbody>{FUNNEL_SUCCESS_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.totals[e] ?? 0}</td></tr>)}</tbody></table>
    <h2 className="mt-6 text-xl font-semibold">Visible sign-in failures</h2><table className="mt-2"><tbody>{FUNNEL_FAILURE_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.totals[e] ?? 0}</td></tr>)}</tbody></table>
    <h2 className="mt-6 text-xl font-semibold">Totals by client class</h2>{CLIENT_CLASSES.map(clientClass => <section key={clientClass} className="mt-4"><h3 className="text-lg font-medium">{clientClass === 'browser' ? 'People (browser)' : clientClass}</h3><table className="mt-2"><tbody>{FUNNEL_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.clientClassTotals[clientClass][e] ?? 0}</td></tr>)}</tbody></table></section>)}
    <h2 className="mt-6 text-xl font-semibold">Event conversion rates (raw event counts)</h2><pre>{JSON.stringify(report.eventConversions, null, 2)}</pre>
    <h2 className="mt-6 text-xl font-semibold">Distinct-workspace conversion rates</h2><p className="text-sm text-zinc-600">Unique workspaces only; null means no data.</p><pre>{JSON.stringify(report.workspaceConversions, null, 2)}</pre>
    <h2 className="mt-6 text-xl font-semibold">Top referrers</h2><p className="text-sm text-zinc-600">{report.externalReferralViews} view(s) arrived from another site, {report.ownReferralViews} were hops through our own redirects and are not arrivals.</p><ul>{report.topReferrers.map(r => <li key={r.host}>{r.host}: {r.count}{isOwnReferrer(r.host) ? ' (ours)' : ''}</li>)}</ul></section>;
}
