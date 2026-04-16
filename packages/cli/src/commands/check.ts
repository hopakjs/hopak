import { relative } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import {
  ModelRegistry,
  Router,
  Scanner,
  applyConfig,
  loadConfigFile,
  loadFileRoutes,
} from '@hopak/core';

export interface CheckCommandOptions {
  cwd?: string;
  log: Logger;
}

interface CheckLine {
  ok: boolean;
  label: string;
  detail?: string;
  hints?: string[];
}

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
} as const;

const CRUD_ENDPOINTS_PER_MODEL = 6;

function symbol(ok: boolean): string {
  return ok ? `${ANSI.green}✓${ANSI.reset}` : `${ANSI.red}✗${ANSI.reset}`;
}

function format(lines: readonly CheckLine[]): string {
  const out: string[] = [''];
  for (const line of lines) {
    const detail = line.detail ? `  ${line.detail}` : '';
    out.push(`  ${symbol(line.ok)} ${line.label}${detail}`);
    if (line.hints) {
      for (const hint of line.hints) {
        out.push(`      ${ANSI.yellow}→${ANSI.reset} ${hint}`);
      }
    }
  }
  out.push('');
  return out.join('\n');
}

interface CheckOutcome {
  lines: CheckLine[];
  failed: boolean;
}

export async function runCheck(options: CheckCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const outcome = await collectChecks(cwd);
  process.stdout.write(format(outcome.lines));
  return outcome.failed ? 1 : 0;
}

async function collectChecks(cwd: string): Promise<CheckOutcome> {
  const lines: CheckLine[] = [];
  let failed = false;

  const userConfig = await loadConfigFile(cwd);
  const config = applyConfig(cwd, userConfig);

  lines.push({
    ok: true,
    label: 'Config',
    detail: userConfig ? 'hopak.config.ts loaded' : 'using defaults',
  });

  const dbLocation = config.database.file ?? config.database.url ?? 'in-memory';
  lines.push({
    ok: true,
    label: 'Database',
    detail: `${config.database.dialect} (${dbLocation})`,
  });

  const registry = new ModelRegistry();
  const scan = await new Scanner({ modelsDir: config.paths.models, registry }).scanModels();
  if (scan.errors.length > 0) {
    failed = true;
    lines.push({
      ok: false,
      label: 'Models',
      detail: `${scan.models} loaded, ${scan.errors.length} error(s)`,
      hints: scan.errors.map((e) => `${relative(cwd, e.file)}: ${e.message}`),
    });
  } else if (scan.models === 0) {
    lines.push({ ok: true, label: 'Models', detail: 'no models yet (add files to app/models/)' });
  } else {
    const names = registry
      .all()
      .map((m) => m.name)
      .join(', ');
    lines.push({ ok: true, label: 'Models', detail: `${scan.models} loaded (${names})` });
  }

  const router = new Router();
  const routes = await loadFileRoutes({ routesDir: config.paths.routes, router });
  if (routes.errors.length > 0) {
    failed = true;
    lines.push({
      ok: false,
      label: 'Routes',
      detail: `${routes.routes} loaded, ${routes.errors.length} error(s)`,
      hints: routes.errors.map((e) => `${relative(cwd, e.file)}: ${e.message}`),
    });
  } else {
    lines.push({ ok: true, label: 'Routes', detail: `${routes.routes} file route(s)` });
  }

  const crudModels = registry.all().filter((m) => m.options.crud);
  const crudEndpoints = crudModels.length * CRUD_ENDPOINTS_PER_MODEL;
  lines.push({
    ok: true,
    label: 'Auto-CRUD',
    detail: `${crudModels.length} model(s) with crud:true → ${crudEndpoints} endpoint(s)`,
  });

  const publicExists = await pathExists(config.paths.public);
  lines.push({
    ok: true,
    label: 'Static',
    detail: publicExists
      ? `serving ${relative(cwd, config.paths.public)}/`
      : 'no public/ directory',
  });

  return { lines, failed };
}
