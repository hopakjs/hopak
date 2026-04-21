import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists } from '@hopak/common';
import type { UseContext, UseHandler, UseOutcome } from './registry';

const AUTH_MIDDLEWARE = `import { jwtAuth } from '@hopak/auth';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is not set (see .env.example).');

export const { requireAuth, signToken } = jwtAuth({ secret });
`;

const USER_MODEL = `import { email, model, password, text } from '@hopak/core';

export default model('user', {
  name: text().required().min(2).max(80),
  email: email().required().unique(),
  password: password().required().min(8),
});
`;

const SIGNUP_ROUTE = `import { defineRoute } from '@hopak/core';
import { credentialsSignup } from '@hopak/auth';
import user from '../../../models/user';
import { signToken } from '../../../middleware/auth';

export const POST = defineRoute({
  handler: credentialsSignup({ model: user, sign: signToken }),
});
`;

const LOGIN_ROUTE = `import { defineRoute } from '@hopak/core';
import { credentialsLogin } from '@hopak/auth';
import user from '../../../models/user';
import { signToken } from '../../../middleware/auth';

export const POST = defineRoute({
  handler: credentialsLogin({ model: user, sign: signToken }),
});
`;

const ME_ROUTE = `import { defineRoute } from '@hopak/core';
import { requireAuth } from '../../../middleware/auth';

export const GET = defineRoute({
  before: [requireAuth()],
  handler: (ctx) => ctx.user,
});
`;

const JWT_ENV_COMMENT = '# 32+ bytes of randomness. `openssl rand -hex 32` is fine.';

interface ScaffoldFile {
  path: string;
  contents: string;
}

const FILES: readonly ScaffoldFile[] = [
  { path: 'app/middleware/auth.ts', contents: AUTH_MIDDLEWARE },
  { path: 'app/routes/api/auth/signup.ts', contents: SIGNUP_ROUTE },
  { path: 'app/routes/api/auth/login.ts', contents: LOGIN_ROUTE },
  { path: 'app/routes/api/auth/me.ts', contents: ME_ROUTE },
];

export const authHandler: UseHandler = {
  name: 'auth',
  description: 'JWT auth — signup/login/me routes + requireAuth() middleware',

  async isInstalled(ctx) {
    return pathExists(join(ctx.root, 'app/middleware/auth.ts'));
  },

  async install(ctx): Promise<UseOutcome> {
    const pkgPath = join(ctx.root, 'package.json');
    if (!(await pathExists(pkgPath))) {
      return {
        status: 'error',
        message: `package.json not found in ${ctx.root}. Run this command inside a Hopak project.`,
      };
    }

    const userModelPath = join(ctx.root, 'app/models/user.ts');
    const createUserModel = !(await pathExists(userModelPath));

    for (const file of FILES) {
      if (await pathExists(join(ctx.root, file.path))) {
        return {
          status: 'conflict',
          message: `${file.path} already exists. Delete it (or merge by hand) and rerun.`,
          snippet: file.contents,
        };
      }
    }

    if (createUserModel) {
      await writeTo(userModelPath, USER_MODEL);
      ctx.log.info('Created app/models/user.ts');
    } else {
      ctx.log.info('Reusing existing app/models/user.ts');
    }

    for (const file of FILES) {
      await writeTo(join(ctx.root, file.path), file.contents);
      ctx.log.info(`Created ${file.path}`);
    }

    await patchEnvSecret(ctx);

    const installed = await installAuthPackages(ctx);
    if (!installed.ok) {
      return {
        status: 'error',
        message: `Failed to install auth dependencies: ${installed.error}. Run manually: bun add @hopak/auth jose`,
      };
    }

    return {
      status: 'ok',
      nextSteps: [
        'Set JWT_SECRET in .env (copy from .env.example, then `openssl rand -hex 32`).',
        'Try it: `curl -X POST http://localhost:3000/api/auth/signup -H "content-type: application/json" -d \'{"name":"Ada","email":"a@b.com","password":"hunter2hunter"}\'`',
        'Gate any route with `before: [requireAuth()]` from app/middleware/auth.ts.',
      ],
    };
  },
};

async function writeTo(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, contents);
}

async function patchEnvSecret(ctx: UseContext): Promise<void> {
  const envExamplePath = join(ctx.root, '.env.example');
  const source = (await pathExists(envExamplePath))
    ? await Bun.file(envExamplePath).text()
    : '# Add secrets here\n';
  if (source.includes('JWT_SECRET')) return;

  const separator = source.endsWith('\n') ? '' : '\n';
  const updated = `${source}${separator}${JWT_ENV_COMMENT}\nJWT_SECRET=change-me\n`;
  await Bun.write(envExamplePath, updated);
  ctx.log.info('Added JWT_SECRET to .env.example');
  // A .env that's already initialized but missing the key is a common trap.
  // We won't touch .env (it's user-owned) but we'll warn.
  const envPath = join(ctx.root, '.env');
  if (await pathExists(envPath)) {
    const env = await Bun.file(envPath).text();
    if (!env.includes('JWT_SECRET')) {
      ctx.log.warn('Your .env does not contain JWT_SECRET — copy it over from .env.example.');
    }
  }
}

interface InstallResult {
  ok: boolean;
  error?: string;
}

async function installAuthPackages(ctx: UseContext): Promise<InstallResult> {
  ctx.log.info('Installing @hopak/auth + jose...');
  const proc = Bun.spawn({
    cmd: ['bun', 'add', '@hopak/auth', 'jose'],
    cwd: ctx.root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) return { ok: false, error: `exit code ${code}` };
  return { ok: true };
}
