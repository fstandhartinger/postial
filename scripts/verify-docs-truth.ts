import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plans } from '../lib/plans';

const read = (file: string) => readFileSync(file, 'utf8');
const blueskyGuide = read('content/help/connect-bluesky.md');
const mastodonGuide = read('content/help/connect-mastodon.md');
const brandsGuide = read('content/help/brands.md');
const calendarGuide = read('content/help/calendar.md');
const billingGuide = read('content/help/billing.md');
const brandPage = read('app/app/brands/[id]/page.tsx');
const calendarPage = read('app/app/calendar/page.tsx');
const postPage = read('app/app/posts/[id]/page.tsx');
const billingPage = read('app/app/billing/page.tsx');
const blueskyAdapter = read('lib/publishers/bluesky.ts');
const mastodonAdapter = read('lib/publishers/mastodon.ts');

// Provider limits and credentials named by the guides must remain tied to the adapters.
assert.match(blueskyAdapter, /provider: 'bluesky', maxMediaBytes: 1000000, maxTextLength: 300/);
assert.match(blueskyAdapter, /key: 'identifier', label: 'Handle or email'/);
assert.match(blueskyAdapter, /key: 'appPassword', label: 'App password'/);
assert.match(mastodonAdapter, /provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500/);
assert.match(mastodonAdapter, /key: 'instanceUrl', label: 'Instance URL'/);
assert.match(mastodonAdapter, /key: 'accessToken', label: 'Access token'/);
assert.match(blueskyGuide, /300 graphemes, including any attached link/);
assert.match(blueskyGuide, /up to four images, each no larger than 1 MB/);
assert.match(mastodonGuide, /default is 500/);
assert.match(mastodonGuide, /up to four images, each no larger than 1 MB/);
assert.match(brandPage, /Connect a channel/);
assert.match(brandPage, /Preferences → Development → New\s+application/);
assert.match(brandPage, /Settings → App Passwords/);

// Plan figures in the guides are the product entitlements, not copied marketing values.
const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
assert.match(brandsGuide, new RegExp(`Starter allows ${numberWords[plans.starter.brands]} brands; Agency allows ${numberWords[plans.agency.brands]}`));
assert.match(billingGuide, new RegExp(`Starter costs €${plans.starter.monthlyEuro} per month for ${numberWords[plans.starter.brands]} brands and ${numberWords[plans.starter.seats]} seat`));
assert.match(billingGuide, new RegExp(`Agency costs €${plans.agency.monthlyEuro} per month for ${numberWords[plans.agency.brands]} brands and ${numberWords[plans.agency.seats]} seats`));
assert.match(billingGuide, /14-day trial/);
assert.match(brandsGuide, /oldest brands within the limit stay editable and extra brands become read-only/);

// Calendar instructions are the labels and state guards actually rendered by the app.
assert.match(calendarPage, /Plan several posts/);
assert.match(postPage, /\["scheduled","approved"\]/);
assert.match(postPage, /Changing only the date preserves client approval/);
assert.match(calendarGuide, /Use Reschedule on an unstarted scheduled or approved post/);
assert.match(calendarGuide, /Use Plan several posts/);
assert.match(billingPage, /Start 14-day free trial/);
assert.match(billingPage, /Manage payment method, plan and cancellation/);
assert.match(billingPage, /View invoice history/);

console.log('PASS docs-truth: five guides, provider adapters, plan limits, rendered labels and state guards');
