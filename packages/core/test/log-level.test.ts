import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app/create';

async function emptyProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hopak-loglevel-'));
  await mkdir(join(root, 'app', 'models'), { recursive: true });
  await mkdir(join(root, 'app', 'routes'), { recursive: true });
  return root;
}

describe('config.logLevel', () => {
  test('debug in config is carried into the created logger', async () => {
    const root = await emptyProject();
    const app = await createApp({ rootDir: root, config: { logLevel: 'debug' } });

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };
    app.log.debug('marker-debug');
    app.log.info('marker-info');
    console.log = origLog;

    expect(lines.some((l) => l.includes('marker-debug'))).toBe(true);
    expect(lines.some((l) => l.includes('marker-info'))).toBe(true);

    await app.db.close();
    await rm(root, { recursive: true, force: true });
  });

  test('default level (undefined) filters debug out', async () => {
    const root = await emptyProject();
    const app = await createApp({ rootDir: root, config: {} });

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };
    app.log.debug('should-be-filtered');
    app.log.info('should-pass');
    console.log = origLog;

    expect(lines.some((l) => l.includes('should-be-filtered'))).toBe(false);
    expect(lines.some((l) => l.includes('should-pass'))).toBe(true);

    await app.db.close();
    await rm(root, { recursive: true, force: true });
  });
});
