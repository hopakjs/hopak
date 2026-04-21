import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestServer, createTestServer } from '../src';

const corePath = new URL('../../core/src/index.ts', import.meta.url).pathname;

let workDir: string;
let env: TestServer;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hopak-testing-root-'));
  await mkdir(join(workDir, 'app', 'models'), { recursive: true });
  await mkdir(join(workDir, 'app', 'routes', 'api', 'widgets'), { recursive: true });

  await writeFile(
    join(workDir, 'hopak.config.ts'),
    `import { defineConfig } from '${corePath}';\nexport default defineConfig({ server: { port: 3000 }, database: { dialect: 'sqlite' } });\n`,
  );

  await writeFile(
    join(workDir, 'app', 'models', 'widget.ts'),
    `import { model, text } from '${corePath}';\nexport default model('widget', { name: text().required().min(2) });\n`,
  );

  // File-route scaffold (equivalent to `hopak generate crud widget` output).
  // This is what a real Hopak project would contain — nothing is implicit.
  await writeFile(
    join(workDir, 'app', 'routes', 'api', 'widgets.ts'),
    `import { crud } from '${corePath}';\nimport widget from '../../models/widget';\nexport const GET = crud.list(widget);\nexport const POST = crud.create(widget);\n`,
  );
  await writeFile(
    join(workDir, 'app', 'routes', 'api', 'widgets', '[id].ts'),
    `import { crud } from '${corePath}';\nimport widget from '../../../models/widget';\nexport const GET = crud.read(widget);\nexport const PATCH = crud.patch(widget);\nexport const DELETE = crud.remove(widget);\n`,
  );

  await writeFile(
    join(workDir, 'app', 'routes', 'health.ts'),
    `import { defineRoute } from '${corePath}';\nexport const GET = defineRoute({ handler: () => ({ ok: true }) });\n`,
  );

  env = await createTestServer({ rootDir: workDir });
});

afterAll(async () => {
  if (env) await env.stop();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe('createTestServer({ rootDir })', () => {
  test('scans file routes from the project', async () => {
    const res = await env.client.get<{ ok: boolean }>('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('CRUD routes from scaffolded files serve the model', async () => {
    const created = await env.client.post<{ id: number; name: string }>('/api/widgets', {
      name: 'one',
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('one');

    const list = await env.client.get<{ items: unknown[]; total: number }>('/api/widgets');
    expect(list.body.total).toBe(1);
  });

  test('refuses mixing rootDir with router/models', async () => {
    await expect(createTestServer({ rootDir: workDir, models: [] })).rejects.toThrow(
      /mutually exclusive/,
    );
  });
});
