import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRegistry, Scanner } from '../src';

let workDir: string;

async function writeModel(relative: string, source: string): Promise<void> {
  const fullPath = join(workDir, relative);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, source, 'utf8');
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hopak-scanner-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('Scanner.scanModels', () => {
  test('returns empty result when models dir does not exist', async () => {
    const registry = new ModelRegistry();
    const scanner = new Scanner({
      modelsDir: join(workDir, 'missing'),
      registry,
    });
    const result = await scanner.scanModels();
    expect(result.models).toBe(0);
    expect(result.files).toEqual([]);
    expect(registry.size).toBe(0);
  });

  test('discovers and registers a single model', async () => {
    await writeModel(
      'models/post.ts',
      `import { model, text } from '${getCorePath()}';
export default model('post', { title: text().required() });
`,
    );
    const registry = new ModelRegistry();
    const scanner = new Scanner({
      modelsDir: join(workDir, 'models'),
      registry,
    });
    const result = await scanner.scanModels();
    expect(result.models).toBe(1);
    expect(result.errors).toEqual([]);
    expect(registry.has('post')).toBe(true);
  });

  test('discovers nested models', async () => {
    await writeModel(
      'models/blog/post.ts',
      `import { model, text } from '${getCorePath()}';
export default model('post', { title: text().required() });
`,
    );
    await writeModel(
      'models/auth/user.ts',
      `import { model, email, password } from '${getCorePath()}';
export default model('user', { email: email().required(), password: password().required() });
`,
    );
    const registry = new ModelRegistry();
    const scanner = new Scanner({
      modelsDir: join(workDir, 'models'),
      registry,
    });
    const result = await scanner.scanModels();
    expect(result.models).toBe(2);
    expect(registry.has('post')).toBe(true);
    expect(registry.has('user')).toBe(true);
  });

  test('reports error for file without default model export', async () => {
    await writeModel('models/notmodel.ts', 'export const helper = () => 42;\n');
    const registry = new ModelRegistry();
    const scanner = new Scanner({
      modelsDir: join(workDir, 'models'),
      registry,
    });
    const result = await scanner.scanModels();
    expect(result.models).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/does not export a model/);
  });

  test('reports error and continues on broken file', async () => {
    await writeModel(
      'models/good.ts',
      `import { model, text } from '${getCorePath()}';
export default model('good', { name: text().required() });
`,
    );
    await writeModel('models/broken.ts', 'this is not valid typescript {{{\n');
    const registry = new ModelRegistry();
    const scanner = new Scanner({
      modelsDir: join(workDir, 'models'),
      registry,
    });
    const result = await scanner.scanModels();
    expect(result.models).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(registry.has('good')).toBe(true);
  });
});

function getCorePath(): string {
  return new URL('../src/index.ts', import.meta.url).pathname;
}
