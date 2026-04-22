import { boolean, model, number, password, text } from '@hopak/core';
import { serializeForResponse, serializeListForResponse } from '@hopak/core';
import { Router } from '@hopak/core';

const post = model('post', {
  title: text().required(),
  content: text().required(),
  views: number().default(0),
  published: boolean().default(false),
  secret: password().required(),
});

const rows = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  title: `Post ${i}`,
  content: `Content ${i}`.repeat(10),
  views: i * 3,
  published: i % 2 === 0,
  secret: `hash-${i}`,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

function bench(name: string, iters: number, fn: () => unknown): void {
  // warmup
  for (let i = 0; i < 1000; i++) fn();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iters; i++) fn();
  const elapsedNs = Bun.nanoseconds() - start;
  const perOp = elapsedNs / iters;
  const opsSec = (1e9 / perOp).toFixed(0);
  console.log(
    `  ${name.padEnd(45)} ${perOp.toFixed(1).padStart(10)} ns/op   ${opsSec.padStart(10)} ops/s`,
  );
}

console.log('=== Serialize ===');
bench('serializeListForResponse(100 rows)', 10_000, () => serializeListForResponse(rows, post));
bench('serializeForResponse (single row)', 100_000, () => serializeForResponse(rows[0], post));

console.log('\n=== Router ===');
const router = new Router();
const verbs: ReadonlyArray<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'> = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];
for (let i = 0; i < 50; i++) {
  for (const m of verbs) {
    router.add(m, `/api/model${i}/[id]`, { handler: () => null });
    router.add(m, `/api/model${i}`, { handler: () => null });
  }
}
router.add('GET', '/api/match-me/[id]', { handler: () => null });
bench('router.match — early hit', 100_000, () => router.match('GET', '/api/model0/1'));
bench('router.match — late hit', 100_000, () => router.match('GET', '/api/model49/1'));
bench('router.match — miss', 100_000, () => router.match('GET', '/nope/no/way'));
bench('router.allowedMethods — miss', 100_000, () => router.allowedMethods('/nope'));
