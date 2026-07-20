'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyInitData } = require('../src/initdata');

function signed(token, user, authDate = Math.floor(Date.now() / 1000)) {
  const values = new URLSearchParams({ auth_date: String(authDate), query_id: 'test', user: JSON.stringify(user) });
  const check = [...values].map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  values.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return values.toString();
}

test('verifies Telegram Mini App initData and rejects tampering', () => {
  const token = '123456:secret';
  const input = signed(token, { id: 352253483, first_name: 'Admin' });
  assert.deepEqual(verifyInitData(input, token).tgId, '352253483');
  assert.equal(verifyInitData(input.replace('Admin', 'Attacker'), token).ok, false);
});
