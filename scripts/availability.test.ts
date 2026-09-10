import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkAvailability, MarketingAccessStatus, networkSummary } from '../components/marketing/NetworkAvailability';
import { FAQ } from '../components/marketing/FAQ';
test('landing FAQ uses the same unconfigured availability as its summary', () => {
  for (const key of keys) delete process.env[key];
  const html = renderToStaticMarkup(React.createElement(FAQ));
  assert.doesNotMatch(html, /Connect available|Google sign-in and magic links are available/);
});
const keys = ['AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET','SMTP_URL','EMAIL_FROM','X_CLIENT_ID','X_CLIENT_SECRET','THREADS_APP_ID','THREADS_APP_SECRET','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET'];
test('network summary does not contradict configured Early access connections', () => {
  assert.doesNotMatch(networkSummary, /awaiting developer access/);
});
test('unconfigured public cards and sign-in do not advertise unavailable connections', async () => {
  for (const key of keys) delete process.env[key];
  const cards = renderToStaticMarkup(await NetworkAvailability({}));
  const status = renderToStaticMarkup(await MarketingAccessStatus());
  assert.doesNotMatch(cards, /Connect available/);
  assert.match(cards, /Connection not configured/);
  assert.doesNotMatch(status, /Google sign-in and magic links are available/);
  assert.match(status, /Sign-in is not configured/);
});
test('configured cards preserve provider limits; partial sign-in advertises only the configured method', async () => {
  for (const key of keys) process.env[key] = 'fixture-only';
  const cards = renderToStaticMarkup(await NetworkAvailability({}));
  assert.equal((cards.match(/Connect available/g) || []).length, 3);
  assert.match(cards, /pay-per-use/); assert.match(cards, /approved testers/); assert.match(cards, /company pages is under review/);
  assert.doesNotMatch(cards, /Connection not configured/);
  assert.match(renderToStaticMarkup(await MarketingAccessStatus()), /Google sign-in and magic links are available/);
  delete process.env.SMTP_URL;
  assert.match(renderToStaticMarkup(await MarketingAccessStatus()), /Google sign-in is available/);
  assert.doesNotMatch(renderToStaticMarkup(await MarketingAccessStatus()), /magic links are available/);
  delete process.env.AUTH_GOOGLE_SECRET; process.env.SMTP_URL = 'fixture-only';
  assert.match(renderToStaticMarkup(await MarketingAccessStatus()), /Magic links are available/);
  delete process.env.X_CLIENT_SECRET;
  assert.equal((renderToStaticMarkup(await NetworkAvailability({})).match(/Connect available/g) || []).length, 2);
  for (const key of keys) delete process.env[key];
});
