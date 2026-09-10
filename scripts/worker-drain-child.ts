import { appendFileSync, existsSync } from 'node:fs';
import { getDb } from '../db';
import { registerPublisher } from '../lib/publishers';
import { tick } from '../lib/publishing';
import { startPublishingWorker } from '../lib/publishing/start';

const [mode, targetId, dir] = process.argv.slice(2);
const entered = `${dir}/entered-${targetId}`;
const release = `${dir}/release-${targetId}`;
registerPublisher({ provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500, credentialFields: [],
  async validate() { return { externalId: 'fixture', displayName: 'Fixture' }; },
  async publish(_credentials, input) {
    appendFileSync(`${dir}/calls-${targetId}`, `${input.idempotencyKey}\n`);
    appendFileSync(entered, 'entered\n');
    if (mode === 'wait' || mode === 'worker') while (!existsSync(release)) await new Promise(r => setTimeout(r, 10));
    return { remoteId: input.idempotencyKey, url: 'https://example.invalid/post' };
  },
});
async function main() {
  if (mode === 'worker') { startPublishingWorker(); setInterval(() => {}, 1000); }
  else { await tick(); await getDb().$client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
