export class TokenBucket {
  constructor({ capacity, refillPerMs }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  refill(now = Date.now()) {
    const elapsed = Math.max(0, now - this.lastRefill);
    if (elapsed <= 0) return;

    const add = elapsed * this.refillPerMs;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.lastRefill = now;
    }
  }

  get waitMsForToken() {
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil(deficit / this.refillPerMs);
  }

  tryConsume(count = 1, now = Date.now()) {
    this.refill(now);
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }
}

export class CompositeRateLimiter {
  constructor(buckets = []) {
    this.buckets = buckets;
  }

  async acquire(count = 1) {
    while (true) {
      const now = Date.now();
      const canConsume = this.buckets.every((bucket) => bucket.tryConsume(count, now));
      if (canConsume) return;

      const waitMs = Math.max(
        1,
        ...this.buckets.map((bucket) => bucket.waitMsForToken)
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export function createRiotRateLimiter({ perSecond = 20, perTwoMinutes = 100 } = {}) {
  const perSecondBucket = new TokenBucket({
    capacity: perSecond,
    refillPerMs: perSecond / 1000,
  });

  const perTwoMinutesBucket = new TokenBucket({
    capacity: perTwoMinutes,
    refillPerMs: perTwoMinutes / (120 * 1000),
  });

  return new CompositeRateLimiter([perSecondBucket, perTwoMinutesBucket]);
}
