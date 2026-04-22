import { resolve } from 'node:path';
import { pathExists } from '@hopak/common';
import { Glob } from 'bun';
import type { Migration, MigrationContext } from './types';

const MIGRATION_GLOB = '*.ts';
const EXT_RE = /\.ts$/;

/**
 * Scan `migrationsDir` for migration files, dynamically import each,
 * and return them sorted by id (which is timestamp-prefixed, so lexicographic
 * order = chronological order).
 *
 * A file must export `up(ctx)` and `down(ctx)`. `description` is optional.
 * Files that don't match the shape are reported so the CLI can surface
 * them — we don't throw here so `migrate status` can still list the good ones.
 */
export interface RegistryResult {
  readonly migrations: readonly Migration[];
  readonly errors: readonly RegistryError[];
}

export interface RegistryError {
  readonly file: string;
  readonly message: string;
}

export async function loadMigrations(migrationsDir: string): Promise<RegistryResult> {
  if (!(await pathExists(migrationsDir))) {
    return { migrations: [], errors: [] };
  }

  const migrations: Migration[] = [];
  const errors: RegistryError[] = [];

  const glob = new Glob(MIGRATION_GLOB);
  for await (const relativePath of glob.scan({ cwd: migrationsDir })) {
    const fullPath = resolve(migrationsDir, relativePath);
    const id = relativePath.replace(EXT_RE, '');
    try {
      const mod = (await import(fullPath)) as {
        up?: (ctx: MigrationContext) => Promise<void>;
        down?: (ctx: MigrationContext) => Promise<void>;
        description?: unknown;
      };
      if (typeof mod.up !== 'function' || typeof mod.down !== 'function') {
        errors.push({
          file: fullPath,
          message: 'Missing `up` / `down` export. A migration must export both as async functions.',
        });
        continue;
      }
      const description = typeof mod.description === 'string' ? mod.description : undefined;
      migrations.push({
        id,
        up: mod.up,
        down: mod.down,
        ...(description !== undefined ? { description } : {}),
      });
    } catch (cause) {
      errors.push({
        file: fullPath,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  migrations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { migrations, errors };
}

/** Stable id for a migration file created right now. UTC, no colons. */
export function newMigrationId(name: string, at: Date = new Date()): string {
  const iso = at.toISOString(); // e.g. 2026-04-22T15:30:12.345Z
  const stamp = iso.replace(/[-:.]/g, '').slice(0, 18); // 20260422T153012345
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('Migration name must contain letters or digits.');
  return `${stamp}_${slug}`;
}
