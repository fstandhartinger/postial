export function statusLabel(status: string): string {
  const labels: Record<string, string> = {'alert.test': 'Test alert', pending: 'Waiting to send', delivered: 'Delivered', retrying: 'Retrying delivery', canceled: 'Canceled', active: 'Active', disconnected: 'Disconnected', 'approval.decided':'Client approval decision',needs_review: 'Needs your review', held: 'Paused — subscription inactive', partially_failed: 'Published on some channels', failed: 'Not published — automatic attempts ended', pending_approval: 'Awaiting client approval', changes_requested: 'Changes requested', token_expired: 'Reconnect channel', queued: 'Scheduled', approved: 'Approved', published: 'Published', publishing: 'Publishing', scheduled: 'Scheduled', draft: 'Draft', skipped: 'Skipped'};
  if (status.startsWith('alert.')) return statusLabel(status.slice(6));
  return labels[status] ?? status.replaceAll('_', ' ').replaceAll('.', ' ').replace(/^./, c => c.toUpperCase());
}
