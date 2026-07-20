'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VpsAdminFirestore } = require('../bot-firestore-compat');

test('bot compatibility layer supports doc and query APIs', async () => {
  const rows = new Map([
    ['base/students/a', { classCode: 'A', totalSolved: 5 }],
    ['base/students/b', { classCode: 'B', totalSolved: 10 }],
  ]);
  const client = {
    async get(path) {
      const data = rows.get(path);
      return { doc: data ? { id: path.split('/').pop(), data } : null };
    },
    async query(path, constraints) {
      let docs = [...rows].filter(([key]) => key.startsWith(`${path}/`)).map(([key, data]) => ({ id: key.split('/').pop(), data }));
      for (const c of constraints) if (c.type === 'where') docs = docs.filter(row => row.data[c.field] === c.value);
      return { docs };
    },
    async write(path, data, mode) { rows.set(path, mode === 'merge' ? { ...(rows.get(path) || {}), ...data } : data); },
    async remove(path) { rows.delete(path); },
  };
  const db = new VpsAdminFirestore(client);
  const doc = await db.doc('base/students/a').get();
  assert.equal(doc.exists, true);
  assert.equal(doc.data().totalSolved, 5);
  await doc.ref.set({ premium: true }, { merge: true });
  assert.equal((await doc.ref.get()).data().premium, true);
  const query = await db.collection('base/students').where('classCode', '==', 'B').count().get();
  assert.equal(query.data().count, 1);
});

test('bot compatibility layer claims and acknowledges durable notifications', async () => {
  const calls = [];
  let claimed = false;
  const client = {
    async claimNotifications() {
      if (claimed) return { jobs: [] };
      claimed = true;
      return { jobs: [{ id: 'job/encoded', type: 'hw_done', classCode: 'A' }] };
    },
    async ackNotification(id) { calls.push(['ack', id]); },
    async failNotification(id, error) { calls.push(['fail', id, error.message]); },
  };
  const db = new VpsAdminFirestore(client);
  await new Promise((resolve, reject) => {
    const stop = db.collection('base/notifyJobs').onSnapshot(async snapshot => {
      try {
        const [change] = snapshot.docChanges();
        assert.equal(change.doc.data().type, 'hw_done');
        await change.doc.ref.delete();
        stop();
        resolve();
      } catch (error) { reject(error); }
    }, reject);
  });
  assert.deepEqual(calls, [['ack', 'job/encoded']]);
});
