export function statusLabel(status: string) {
  const labels: Record<string, string> = {needs_review: 'Needs your review', held: 'Paused — subscription inactive', partially_failed: 'Published on some channels', failed: 'Not published — automatic attempts ended', pending_approval: 'Awaiting client approval', changes_requested: 'Changes requested', token_expired: 'Reconnect channel', queued: 'Scheduled', approved: 'Approved', published: 'Published', publishing: 'Publishing', scheduled: 'Scheduled', draft: 'Draft', skipped: 'Skipped'};
  return labels[status] ?? status.replaceAll('_', ' ');
}
