import { funnelReport } from '@/lib/funnel';
const days = Number(process.argv[2] ?? 30);
console.log(JSON.stringify(await funnelReport(Number.isFinite(days) ? days : 30), null, 2));
