'use strict';

const { env } = require('./env');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const pos = part.indexOf('=');
    if (pos < 1) continue;
    const key = part.slice(0, pos).trim();
    try { out[key] = decodeURIComponent(part.slice(pos + 1).trim()); } catch (_) {}
  }
  return out;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.trunc(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(body);
}

function redirect(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function readJson(req, maxBytes = env.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let settled = false;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes && !settled) {
        settled = true;
        chunks.length = 0;
        const error = new Error('body_too_large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) {
        const error = new Error('invalid_json');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', error => { if (!settled) reject(error); });
  });
}

function requestIp(req) {
  if (env.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || '';
}

function safeReturnTo(raw) {
  const value = String(raw || '/');
  if (!value.startsWith('/') || value.startsWith('//') || /[\r\n]/.test(value)) return '/';
  return value;
}

module.exports = { parseCookies, cookie, json, redirect, readJson, requestIp, safeReturnTo };
