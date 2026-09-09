import {statusLabel} from "@/lib/status-label";
export function ChannelStatusBadge({status}:{status:'active'|'token_expired'|'disconnected'}) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status === 'active' ? 'bg-emerald-50 text-emerald-800' : status === 'token_expired' ? 'bg-amber-100 text-amber-900' : 'bg-zinc-100 text-zinc-700'}`}>{statusLabel(status)}</span>;
}
