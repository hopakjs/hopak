/**
 * Shape written to disk by `hopak migrate new`. Kept here (not in CLI)
 * so runtime introspection tools can also emit migration files.
 */
export interface TemplateOptions {
  readonly description?: string;
  readonly upBody?: string;
  readonly downBody?: string;
}

const DEFAULT_UP = `  // TODO: await ctx.execute('ALTER TABLE ...');`;
const DEFAULT_DOWN = '  // TODO: reverse of up()';

export function renderMigrationTemplate(options: TemplateOptions = {}): string {
  const { description, upBody = DEFAULT_UP, downBody = DEFAULT_DOWN } = options;
  const descLine = description
    ? `\nexport const description = ${JSON.stringify(description)};\n`
    : '';
  return `import type { MigrationContext } from '@hopak/core';
${descLine}
export async function up(ctx: MigrationContext): Promise<void> {
${upBody}
}

export async function down(ctx: MigrationContext): Promise<void> {
${downBody}
}
`;
}
