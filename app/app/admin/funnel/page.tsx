import { auth } from '@/auth';
import { funnelReport, isAdminEmail, isOwnReferrer, FUNNEL_EVENTS, CLIENT_CLASSES, FUNNEL_SUCCESS_EVENTS, FUNNEL_FAILURE_EVENTS } from '@/lib/funnel';
import { notFound } from 'next/navigation';

const accountStages = ['signup_started', 'signup_completed', 'workspace_created', 'channel_connected', 'post_scheduled', 'post_published'] as const;
const trialStages = ['trial_started', 'subscription_active'] as const;
const payingStages = ['checkout_started', 'subscription_paid', 'subscription_active'] as const;
const breakdownClasses = ['browser', 'system', 'unknown'] as const;
type Report = Awaited<ReturnType<typeof funnelReport>>;

function ClassTable({ report, stages }: { report: Report; stages: readonly string[] }) {
  return <table className="mt-2"><tbody>{stages.map(stage => <tr key={stage}>
    <th className="p-2 text-left">{stage}</th>
    {breakdownClasses.map(clientClass => <td key={clientClass} className="p-2 text-right" title={clientClass}>{report.clientClassTotals[clientClass][stage] ?? 0}</td>)}
  </tr>)}</tbody></table>;
}

function pct(rate: number | null): string {
  return rate === null ? 'no data' : `${(rate * 100).toFixed(1)}%`;
}

export default async function FunnelPage() {
  const session = await auth(), email = session?.user?.email?.trim().toLowerCase();
  if (!isAdminEmail(email)) notFound();
  const report = await funnelReport(30);
  return <section><h1 className="text-3xl font-semibold">Funnel</h1><p className="text-sm text-zinc-600">Last {report.days} days, from {report.since}</p>
    <h2 className="mt-6 text-xl font-semibold">Registrations</h2><p className="text-sm text-zinc-600">{report.definitions.accountTotals}</p>
    <p className="mt-2 text-xs text-zinc-500">Columns: browser / system / unknown client class.</p><ClassTable report={report} stages={accountStages} />
    <h2 className="mt-6 text-xl font-semibold">Trial starts</h2><p className="text-sm text-zinc-600">{report.definitions.trial_started}</p>
    <ClassTable report={report} stages={trialStages} /><p className="mt-2 text-sm text-zinc-600">{report.definitions.subscription_active}</p>
    <h2 className="mt-6 text-xl font-semibold">Paying conversions</h2><p className="text-sm text-zinc-600">{report.definitions.billingConversions}</p>
    <table className="mt-2"><tbody>
      <tr><th className="p-2 text-left">workspace_created → trial_started</th><td className="p-2 text-right">{pct(report.billingConversions.trial_started)}</td></tr>
      <tr><th className="p-2 text-left">trial_started → subscription_paid</th><td className="p-2 text-right">{pct(report.billingConversions.subscription_paid)}</td></tr>
    </tbody></table>
    <ClassTable report={report} stages={payingStages} />
    <p className="mt-2 text-sm text-zinc-600">{report.definitions.subscription_paid}</p><p className="mt-1 text-sm text-zinc-600">{report.definitions.pastDueRecovery}</p>
    <p className="mt-2 text-sm text-zinc-600">{report.definitions.classAttributionFrom}</p>
    <h2 className="mt-6 text-xl font-semibold">Success funnel</h2><table className="mt-2"><tbody>{FUNNEL_SUCCESS_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.totals[e] ?? 0}</td></tr>)}</tbody></table>
    <h2 className="mt-6 text-xl font-semibold">Visible sign-in failures</h2><table className="mt-2"><tbody>{FUNNEL_FAILURE_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.totals[e] ?? 0}</td></tr>)}</tbody></table>
    <h2 className="mt-6 text-xl font-semibold">Totals by client class</h2>{CLIENT_CLASSES.map(clientClass => <section key={clientClass} className="mt-4"><h3 className="text-lg font-medium">{clientClass === 'browser' ? 'People (browser)' : clientClass === 'internal' ? 'Internal (staff and agents, excluded)' : clientClass === 'system' ? 'System (worker and Stripe webhook)' : clientClass}</h3><table className="mt-2"><tbody>{FUNNEL_EVENTS.map(e => <tr key={e}><th className="p-2 text-left">{e}</th><td className="p-2">{report.clientClassTotals[clientClass][e] ?? 0}</td></tr>)}</tbody></table></section>)}
    <h2 className="mt-6 text-xl font-semibold">Event conversion rates (raw event counts)</h2><div className="overflow-x-auto"><pre>{JSON.stringify(report.eventConversions, null, 2)}</pre></div>
    <h2 className="mt-6 text-xl font-semibold">Distinct-workspace conversion rates</h2><p className="text-sm text-zinc-600">Unique workspaces only; null means no data.</p><div className="overflow-x-auto"><pre>{JSON.stringify(report.workspaceConversions, null, 2)}</pre></div>
    <h2 className="mt-6 text-xl font-semibold">Top referrers</h2><p className="text-sm text-zinc-600">{report.externalReferralViews} view(s) arrived from another site, {report.ownReferralViews} were hops through our own redirects and are not arrivals.</p><ul>{report.topReferrers.map(r => <li key={r.host}>{r.host}: {r.count}{isOwnReferrer(r.host) ? ' (ours)' : ''}</li>)}</ul></section>;
}
