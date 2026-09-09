import Link from 'next/link';
import {unreadNotifications} from '@/lib/notifications';
import {NotificationForm} from '@/components/settings/NotificationForm';
export async function NotificationBell({workspaceId,userId}:{workspaceId:string;userId:string}) {
  const notices=await unreadNotifications(workspaceId,userId);
  return <details className="relative"><summary className="cursor-pointer rounded border p-2" aria-label={`Notifications: ${notices.length} unread`}>🔔 <span className="sr-only">Notifications</span>{notices.length}</summary><div className="absolute right-0 z-40 max-h-96 w-[min(20rem,85vw)] space-y-4 overflow-y-auto rounded-xl border bg-white p-4 shadow-lg"><h2 className="font-semibold">Notifications</h2><Link className="underline" href="/app/settings/notifications">Alert settings</Link>{!notices.length && <p>No unread notifications.</p>}{notices.map(n=><article className="space-y-2 border-t pt-3" key={n.id}><p>{n.message}</p><Link className="underline" href={n.postId?`/app/posts/${n.postId}`:n.type==='held'?'/app/billing':'/app/channels'}>View details</Link><NotificationForm action="read" id={n.id}/></article>)}</div></details>;
}
