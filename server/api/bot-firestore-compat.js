'use strict';

const { HistoryApiClient } = require('./bot-client');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

class AdminDocSnapshot {
  constructor(ref, row) {
    this.ref = ref;
    this.id = row?.id || ref.id;
    this.exists = !!row;
    this._data = row?.data;
  }
  data() { return clone(this._data); }
}

class AdminQuerySnapshot {
  constructor(ref, rows) {
    this.query = ref;
    this.docs = (rows || []).map(row => new AdminDocSnapshot(ref.firestore.doc(`${ref.path}/${row.id}`), row));
    this.size = this.docs.length;
    this.empty = !this.docs.length;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

class DocRef {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = String(path).replace(/^\/+|\/+$/g, '');
    this.id = this.path.split('/').pop();
  }
  async get() {
    const result = await this.firestore.client.get(this.path);
    const row = result.doc || null;
    return new AdminDocSnapshot(this, row || null);
  }
  set(data, options = {}) { return this.firestore.client.write(this.path, data, options.merge ? 'merge' : 'set'); }
  update(data) { return this.firestore.client.write(this.path, data, 'update'); }
  delete() { return this.firestore.client.remove(this.path); }
}

class NotificationDocRef extends DocRef {
  constructor(firestore, path, notificationId) {
    super(firestore, path);
    this.notificationId = notificationId;
  }
  delete() { return this.firestore.client.ackNotification(this.notificationId); }
  fail(error) { return this.firestore.client.failNotification(this.notificationId, error); }
}

class CountQuery {
  constructor(query) { this.query = query; }
  async get() {
    const snap = await this.query.get();
    return { data: () => ({ count: snap.size }) };
  }
}

class QueryRef {
  constructor(firestore, path, constraints = []) {
    this.firestore = firestore;
    this.path = String(path).replace(/^\/+|\/+$/g, '');
    this.constraints = constraints;
  }
  where(field, op, value) { return new QueryRef(this.firestore, this.path, [...this.constraints, { type: 'where', field, op, value }]); }
  orderBy(field, direction = 'asc') { return new QueryRef(this.firestore, this.path, [...this.constraints, { type: 'orderBy', field, direction }]); }
  limit(count) { return new QueryRef(this.firestore, this.path, [...this.constraints, { type: 'limit', count }]); }
  count() { return new CountQuery(this); }
  async get() {
    const result = await this.firestore.client.query(this.path, this.constraints);
    return new AdminQuerySnapshot(this, result.docs || []);
  }
  onSnapshot(onNext, onError = () => {}) {
    if (this.path.endsWith('/notifyJobs')) return this.onNotificationQueue(onNext, onError);
    let stopped = false;
    let previous = new Map();
    let running = false;
    let timer = null;
    const refresh = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const snapshot = await this.get();
        const current = new Map(snapshot.docs.map(doc => [doc.id, doc]));
        const changes = [];
        for (const [id, doc] of current) {
          if (!previous.has(id)) changes.push({ type: 'added', doc });
          else if (!same(previous.get(id).data(), doc.data())) changes.push({ type: 'modified', doc });
        }
        for (const [id, doc] of previous) if (!current.has(id)) changes.push({ type: 'removed', doc });
        previous = current;
        onNext(Object.assign(snapshot, { docChanges: () => changes }));
      } catch (error) {
        if (!stopped) {
          stopped = true;
          if (timer) clearInterval(timer);
          onError(error);
        }
      }
      finally { running = false; }
    };
    refresh();
    const fast = this.path.endsWith('/matches');
    timer = setInterval(refresh, fast ? 1200 : 4000);
    timer.unref?.();
    return () => { stopped = true; clearInterval(timer); };
  }
  onNotificationQueue(onNext, onError = () => {}) {
    let stopped = false;
    let running = false;
    let timer = null;
    const refresh = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const result = await this.firestore.client.claimNotifications();
        const docs = (result.jobs || []).map(job => {
          const id = String(job.id);
          const data = { ...job };
          delete data.id;
          const ref = new NotificationDocRef(this.firestore, `${this.path}/${id}`, id);
          return new AdminDocSnapshot(ref, { id, data });
        });
        if (docs.length) {
          const snapshot = new AdminQuerySnapshot(this, []);
          snapshot.docs = docs;
          snapshot.size = docs.length;
          snapshot.empty = !docs.length;
          snapshot.docChanges = () => docs.map(doc => ({ type: 'added', doc }));
          await onNext(snapshot);
        }
      } catch (error) {
        if (!stopped) {
          stopped = true;
          if (timer) clearInterval(timer);
          onError(error);
        }
      }
      finally { running = false; }
    };
    refresh();
    timer = setInterval(refresh, 1200);
    timer.unref?.();
    return () => { stopped = true; clearInterval(timer); };
  }
}

class VpsAdminFirestore {
  constructor(client) { this.client = client; }
  doc(path) { return new DocRef(this, path); }
  collection(path) { return new QueryRef(this, path); }
}

function createVpsFirestoreCompat(options) {
  const client = new HistoryApiClient(options);
  const firestore = new VpsAdminFirestore(client);
  const FieldValue = {
    arrayUnion: (...values) => ({ __vpsOp: 'arrayUnion', values }),
    arrayRemove: (...values) => ({ __vpsOp: 'arrayRemove', values }),
    delete: () => ({ __vpsOp: 'delete' }),
  };
  return { firestore, admin: { firestore: { FieldValue } }, client };
}

module.exports = { createVpsFirestoreCompat, VpsAdminFirestore, AdminDocSnapshot, AdminQuerySnapshot };
