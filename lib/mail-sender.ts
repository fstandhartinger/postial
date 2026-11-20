export const DEFAULT_POSTIAL_SENDER = 'Postial <noreply@mail.postial.co>';

export function postialSender(value: string | undefined) {
  if (!value || /[\r\n]/.test(value)) return;
  const sender = value.trim();
  const displayAddress = /^[^<>,;]+<([^<>]+)>$/.exec(sender);
  const mailbox = displayAddress ? displayAddress[1] : sender;
  const postialMailbox = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:mail\.)?postial\.co$/i;
  return postialMailbox.test(mailbox) ? sender : undefined;
}

export function requirePostialSender(value: string | undefined) {
  const sender = postialSender(value);
  if (!sender) throw new Error('Postial email requires one From address on postial.co or mail.postial.co');
  return sender;
}
