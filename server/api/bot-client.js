'use strict';

// Drop-in helper for /root/bot/bot.js. It replaces direct Firestore writes
// while the bot keeps its existing SQLite users.db.
class HistoryApiClient {
  constructor({ baseUrl = 'http://127.0.0.1:8792', token }) {
    if (!token) throw new Error('INTERNAL_API_TOKEN is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  async request(path, body = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `history_api_${response.status}`);
    return payload;
  }

  write(path, data, mode = 'merge') {
    return this.request('/internal/v1/store/write', { path, data, mode });
  }

  get(path) {
    return this.request('/internal/v1/store/get', { path });
  }

  remove(path) {
    return this.request('/internal/v1/store/delete', { path });
  }

  query(path, constraints = []) {
    return this.request('/internal/v1/store/query', { path, constraints });
  }

  createMagicToken(token, tgId, name, exp) {
    return this.write(`artifacts/ege-history-bot/public/data/loginTokens/${token}`, { tgId: String(tgId), name, exp }, 'set');
  }

  confirmPcSession(token, tgId, name) {
    return this.write(`artifacts/ege-history-bot/public/data/loginSessions/${token}`,
      { status: 'confirmed', tgId: String(tgId), name, confirmedAt: Date.now() }, 'merge');
  }

  upsertTeacher(tgId, data) {
    return this.write(`artifacts/ege-history-bot/public/data/teachers/${tgId}`, data, 'merge');
  }

  setStudentPremium(studentId, premium) {
    return this.write(`artifacts/ege-history-bot/public/data/students/${studentId}`,
      { premium: !!premium, premiumUpdatedAt: Date.now() }, 'merge');
  }

  setLimits(data) {
    return this.write('artifacts/ege-history-bot/public/data/config/limits', data, 'merge');
  }

  claimNotifications() { return this.request('/internal/v1/notifications/claim'); }
  ackNotification(id) { return this.request(`/internal/v1/notifications/${encodeURIComponent(id)}/ack`); }
  failNotification(id, error) {
    return this.request(`/internal/v1/notifications/${encodeURIComponent(id)}/fail`, { error: String(error?.message || error || '') });
  }
}

module.exports = { HistoryApiClient };
