// Limitation de débit à fenêtre fixe. Trois stores :
//  - memory   : développement et tests (NON partagé entre instances : interdit en production, voir config/env.js)
//  - postgres : production simple, atomique, sans service supplémentaire (une requête SQL par contrôle)
//  - upstash  : production à fort trafic (Redis REST). NON testé contre un vrai compte Upstash ici.

export function createRateLimiter(config, db) {
  const store = config.rateLimitStore;

  if (store === 'postgres') {
    return {
      async hit(key, limit, windowSeconds) {
        const rows = await db.$queryRaw`
          INSERT INTO rate_limits ("key", "count", "resetAt")
          VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
          ON CONFLICT ("key") DO UPDATE SET
            "count"   = CASE WHEN rate_limits."resetAt" <= now() THEN 1 ELSE rate_limits."count" + 1 END,
            "resetAt" = CASE WHEN rate_limits."resetAt" <= now() THEN now() + make_interval(secs => ${windowSeconds}) ELSE rate_limits."resetAt" END
          RETURNING "count", EXTRACT(EPOCH FROM ("resetAt" - now()))::int AS "ttl"`;
        const { count, ttl } = rows[0];
        return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, ttl) };
      },
    };
  }

  if (store === 'upstash') {
    const call = async (commands) => {
      const res = await fetch(`${config.upstash.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.upstash.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`Upstash a répondu ${res.status}`);
      return res.json();
    };
    return {
      async hit(key, limit, windowSeconds) {
        const k = `rl:${key}`;
        const [incr, ttlRes] = await call([['INCR', k], ['TTL', k]]);
        const count = Number(incr.result);
        let ttl = Number(ttlRes.result);
        if (count === 1 || ttl < 0) {
          await call([['EXPIRE', k, windowSeconds]]);
          ttl = windowSeconds;
        }
        return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, ttl) };
      },
    };
  }

  const buckets = new Map();
  return {
    async hit(key, limit, windowSeconds) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowSeconds * 1000 };
        buckets.set(key, b);
      }
      b.count += 1;
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfter: Math.ceil((b.resetAt - now) / 1000) };
    },
    _reset: () => buckets.clear(),
  };
}
