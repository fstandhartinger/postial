import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { SettingsForm } from '@/components/settings/destructive-form';
import { accountAction } from './actions';
export default async function AccountSettings() {
  const session = await auth();
  if(!session?.user?.id) redirect('/login');
  return <><h1 className="text-3xl font-bold">Account settings</h1><h2 className="text-xl font-semibold">Delete my account</h2>
    <p>This permanently deletes your login, sessions and API keys. Your shared posts and media stay with their workspaces, without your creator identity. You cannot delete your account while you are a workspace’s last owner.</p>
    <p><Link href="/app/settings/workspace">Delete a workspace or transfer ownership first</Link></p>
    <SettingsForm action={accountAction} label="Delete my account" confirmation="DELETE"/></>;
}
