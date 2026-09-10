const messages: Record<string,string> = {
  denied: 'Connection was cancelled. No channel was connected. Try Connect again when you are ready.',
  expired: 'This connection link expired or was already used. Open your brand and start Connect again.',
  provider_error: 'The connection did not finish. We do not know why yet. Try Connect again shortly. If it still fails, email info@productivity-boost.com.',
};
export function ConnectError({code}: {code?: string | string[]}) {
  const message = typeof code === 'string' ? messages[code] : undefined;
  return message ? <p role="alert" className="my-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">{message}</p> : null;
}
