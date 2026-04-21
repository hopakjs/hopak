import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@hopak/common';
import { patchMainTs } from '../src/use/main-patcher';
import { requestLogHandler } from '../src/use/request-log-handler';

const DEFAULT_MAIN = "import { hopak } from '@hopak/core';\n\nawait hopak().listen();\n";

describe('patchMainTs — request-log injection', () => {
  const inject = {
    imports: ['requestId', 'requestLog'],
    chain: ['.before(requestId())', '.after(requestLog())'],
  };

  test('template default → patched', () => {
    const result = patchMainTs(DEFAULT_MAIN, inject);
    expect(result.status).toBe('patched');
    expect(result.updated).toContain("import { hopak, requestId, requestLog } from '@hopak/core';");
    expect(result.updated).toContain(
      'await hopak().before(requestId()).after(requestLog()).listen()',
    );
  });

  test('already-patched file is a no-op', () => {
    const patched = patchMainTs(DEFAULT_MAIN, inject).updated;
    expect(patched).toBeString();
    const second = patchMainTs(patched ?? '', inject);
    expect(second.status).toBe('already');
  });

  test('preserves user-added chain steps and de-dupes imports', () => {
    const customised =
      "import { hopak, requestId } from '@hopak/core';\n\n" +
      'await hopak().before(requestId()).listen();\n';
    const result = patchMainTs(customised, inject);
    expect(result.status).toBe('patched');
    expect(result.updated).toContain("import { hopak, requestId, requestLog } from '@hopak/core';");
    expect(result.updated).toContain('.before(requestId()).after(requestLog()).listen(');
  });

  test('non-standard main returns cant-patch with a snippet', () => {
    const weird = "console.log('nothing here')";
    const result = patchMainTs(weird, inject);
    expect(result.status).toBe('cant-patch');
    expect(result.snippet).toContain("from '@hopak/core'");
    expect(result.snippet).toContain('.before(requestId())');
  });

  test('customised requestId args are not re-injected', () => {
    const customised =
      "import { hopak, requestId, requestLog } from '@hopak/core';\n\n" +
      "await hopak().before(requestId({ header: 'X-Trace' })).after(requestLog()).listen();\n";
    const result = patchMainTs(customised, inject);
    expect(result.status).toBe('already');
  });
});

describe('requestLogHandler.install', () => {
  const log = createLogger({ level: 'warn' });
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hopak-use-request-log-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('patches a fresh template project', async () => {
    await writeFile(join(root, 'main.ts'), DEFAULT_MAIN, 'utf8');
    const outcome = await requestLogHandler.install({ root, log });
    expect(outcome.status).toBe('ok');

    const updated = await readFile(join(root, 'main.ts'), 'utf8');
    expect(updated).toContain('await hopak().before(requestId()).after(requestLog()).listen()');
  });

  test('second run reports already-installed', async () => {
    await writeFile(join(root, 'main.ts'), DEFAULT_MAIN, 'utf8');
    await requestLogHandler.install({ root, log });
    const outcome = await requestLogHandler.install({ root, log });
    expect(outcome.status).toBe('already-installed');
  });

  test('missing main.ts → error', async () => {
    const outcome = await requestLogHandler.install({ root, log });
    expect(outcome.status).toBe('error');
  });
});
