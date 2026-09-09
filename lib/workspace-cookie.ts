import { cookies } from 'next/headers';
export async function setWorkspaceCookie(id: string) {
  (await cookies()).set('sm_ws', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 31536000 });
}
