'use strict';

class MemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref();
  }

  take(key, limit, windowMs = 60000) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { ok: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}

module.exports = { MemoryRateLimiter };
