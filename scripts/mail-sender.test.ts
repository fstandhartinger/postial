import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POSTIAL_SENDER, postialSender, requirePostialSender } from '../lib/mail-sender';

test('accepts the Postial default and a bare Postial address', () => {
  assert.equal(requirePostialSender(DEFAULT_POSTIAL_SENDER), DEFAULT_POSTIAL_SENDER);
  assert.equal(requirePostialSender('support@postial.co'), 'support@postial.co');
});

test('refuses missing, foreign, lookalike and multiple From addresses', () => {
  for (const invalid of [
    undefined,
    'Postial <noreply@mail.mintapis.com>',
    'support@postial.co.example.org',
    'Postial <support@postial.co>, other@example.org',
    'Postial\r\nBcc: other@example.org <support@postial.co>',
  ]) {
    assert.equal(postialSender(invalid), undefined);
    assert.throws(() => requirePostialSender(invalid), /Postial email requires one From address/);
  }
});
