const messages: Record<string,string> = {
  denied: 'Connection was cancelled. No channel was connected. Try Connect again when you are ready.',
  expired: 'This connection link expired or was already used. Open your brand and start Connect again.',
  provider_error: 'The provider could not complete the connection. Please try Connect again shortly.',
};
export function ConnectError({code}: {code?: string | string[]}) {
  const message = typeof code === 'string' ? messages[code] : undefined;
  return message ? <p role="alert" className="my-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">{message}</p> : null;
}
