import { model, text, crud, defineRoute, Router } from '@hopak/core';
import { createTestServer } from '@hopak/testing';

const post = model('post', {
  title: text().required(),
  content: text().required(),
});

const router = new Router();
router.add('GET', '/', defineRoute({ handler: () => ({ ok: true }) }));
router.add('GET', '/api/posts', crud.list(post));
router.add('GET', '/api/posts/[id]', crud.read(post));
router.add('POST', '/api/posts', crud.create(post));
for (let i = 0; i < 30; i++) {
  router.add('GET', `/api/dummy${i}`, defineRoute({ handler: () => ({ i }) }));
}

const env = await createTestServer({ models: [post], router });
const db = env.requireDb();
for (let i = 1; i <= 100; i++) {
  await db.model('post').create({ title: `p${i}`, content: `c${i}`.repeat(50) });
}
const base = env.url;

async function loop(label: string, method: string, path: string, iters: number, body?: unknown): Promise<void> {
  const init: RequestInit = body !== undefined
    ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : { method };
  for (let i = 0; i < 200; i++) await fetch(`${base}${path}`, init);
  const start = Bun.nanoseconds();
  for (let i = 0; i < iters; i++) {
    const r = await fetch(`${base}${path}`, init);
    await r.text();
  }
  const ns = Bun.nanoseconds() - start;
  const ms = ns / 1e6;
  const usPer = (ns / iters / 1000).toFixed(1);
  const rps = (iters / (ms / 1000)).toFixed(0);
  console.log(`  ${label.padEnd(30)} ${String(iters).padStart(5)} reqs  ${ms.toFixed(0).padStart(5)}ms  ${usPer.padStart(7)}µs/req  ${rps.padStart(7)} req/s`);
}

console.log('=== E2E (serial fetch loop) ===');
await loop('GET / (trivial)', 'GET', '/', 3000);
await loop('GET /api/posts (list 100)', 'GET', '/api/posts', 1500);
await loop('GET /api/posts/50', 'GET', '/api/posts/50', 2000);
await loop('GET /nope (404)', 'GET', '/nope', 3000);
await loop('GET /api/posts/nope (405)', 'DELETE', '/api/posts', 2000);

await env.stop();
process.exit(0);
