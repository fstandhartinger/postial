import type { Credentials, Publisher } from './types';
import { downloadImage, publishingDeadline, checkLength, guarded, json, jsonBody, postText } from './http';

type Chat = { id: number; title?: string; username?: string };
type Message = { message_id: number; chat: Chat };
async function call<T>(credentials: Credentials, method: string, body: unknown = {}) {
  const response = await json<{ result: T }>('Telegram', `https://api.telegram.org/bot${credentials.botToken}/${method}`, jsonBody(body));
  return response.result;
}
// Split on UTF-16 boundaries without cutting a surrogate pair.
function captionSplit(text: string) {
  let end = 1024;
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  return [text.slice(0, end), text.slice(end)];
}
export const telegram: Publisher = {
  provider: 'telegram', maxMediaBytes: 10000000, maxTextLength: 4096,
  credentialFields: [
    { key: 'botToken', label: 'Bot token', secret: true, help: 'Create a bot and get its token from @BotFather.' },
    { key: 'chatId', label: 'Channel username or chat ID', secret: false, placeholder: '@yourchannel', help: 'Use @name or a numeric ID. The bot must be an administrator in the channel.' },
  ],
  validate(credentials) { return guarded('Telegram', async () => {
    await call(credentials, 'getMe');
    const chat = await call<Chat>(credentials, 'getChat', { chat_id: credentials.chatId });
    return { externalId: String(chat.id), displayName: chat.title || (chat.username ? `@${chat.username}` : String(chat.id)), ...(chat.username ? { url: `https://t.me/${chat.username}` } : {}) };
  }); },
  publish(credentials, input) { return publishingDeadline(() => guarded('Telegram', async () => {
    const text = postText(input);
    checkLength('Telegram', text, 4096);
    const media = input.mediaUrls?.slice(0, 10) ?? [];
    for (const url of media) await downloadImage('Telegram', url, telegram.maxMediaBytes);
    const base = { chat_id: credentials.chatId };
    const warnings: string[] = [];
    if ((input.mediaUrls?.length ?? 0) > 10) warnings.push('Telegram allows ten images per album; extra images were omitted.');
    let message: Message;
    if (!media.length) message = await call(credentials, 'sendMessage', { ...base, text, disable_web_page_preview: false });
    else {
      const [caption, rest] = captionSplit(text);
      if (media.length === 1) message = await call(credentials, 'sendPhoto', { ...base, photo: media[0], caption });
      else {
        const messages = await call<Message[]>(credentials, 'sendMediaGroup', { ...base, media: media.map((url, index) => ({ type: 'photo', media: url, ...(index === 0 ? { caption } : {}) })) });
        message = messages[0];
      }
      if (rest) {
        try { await call(credentials, 'sendMessage', { ...base, text: rest, disable_web_page_preview: false }); }
        catch { warnings.push('Images were published, but the remaining text could not be sent. Send the remaining text manually to avoid posting the images twice.'); }
      }
    }
    const username = message.chat.username;
    return { remoteId: String(message.message_id), ...(username ? { url: `https://t.me/${username}/${message.message_id}` } : {}), ...(warnings.length ? { warnings } : {}) };
  }), input.signal); },
};
