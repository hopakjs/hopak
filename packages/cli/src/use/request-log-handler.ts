import { join } from 'node:path';
import { pathExists } from '@hopak/common';
import { patchMainTs } from './main-patcher';
import type { UseContext, UseHandler, UseOutcome } from './registry';

const INJECTION = {
  imports: ['requestId', 'requestLog'] as const,
  chain: ['.before(requestId())', '.after(requestLog())'] as const,
};

export const requestLogHandler: UseHandler = {
  name: 'request-log',
  description: 'Per-request logging — tags each request with an id and logs method/path/status/ms',

  async isInstalled(ctx) {
    const main = await readMain(ctx.root);
    if (main === null) return false;
    return main.includes('requestLog()') && main.includes('requestId()');
  },

  async install(ctx): Promise<UseOutcome> {
    const mainPath = join(ctx.root, 'main.ts');
    const source = await readMain(ctx.root);
    if (source === null) {
      return {
        status: 'error',
        message: `main.ts not found in ${ctx.root}. Run this command inside a Hopak project.`,
      };
    }

    const patch = patchMainTs(source, INJECTION);
    if (patch.status === 'already') return { status: 'already-installed' };
    if (patch.status === 'cant-patch') {
      return {
        status: 'conflict',
        message:
          'Could not patch main.ts automatically — the file has drifted from the template. Paste the snippet below instead.',
        snippet: patch.snippet ?? '',
      };
    }

    await Bun.write(mainPath, patch.updated ?? source);
    ctx.log.info('Patched main.ts — requestId() + requestLog() now run on every request');

    return {
      status: 'ok',
      nextSteps: [
        'Start the server with `hopak dev` — each response now carries an X-Request-Id header.',
        'Switch to structured logs: `.after(requestLog({ format: "json" }))` in main.ts.',
      ],
    };
  },
};

async function readMain(root: string): Promise<string | null> {
  const path = join(root, 'main.ts');
  if (!(await pathExists(path))) return null;
  return Bun.file(path).text();
}
