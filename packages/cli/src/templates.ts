import { dirname, join, posix, relative } from 'node:path';
import type { DbDialect } from '@hopak/common';
import { pluralize } from '@hopak/common';

export interface ProjectTemplate {
  name: string;
  files: Record<string, string>;
}

export interface ProjectTemplateOptions {
  dialect?: DbDialect;
}

const DRIVER_VERSIONS: Partial<Record<DbDialect, { pkg: string; version: string }>> = {
  postgres: { pkg: 'postgres', version: '^3.4.4' },
  mysql: { pkg: 'mysql2', version: '^3.11.5' },
};

const URL_PLACEHOLDERS: Partial<Record<DbDialect, string>> = {
  postgres: 'postgres://user:pass@localhost:5432/myapp',
  mysql: 'mysql://user:pass@localhost:3306/myapp',
};

function databaseConfigBlock(dialect: DbDialect): string {
  if (dialect === 'sqlite') {
    return `database: { dialect: 'sqlite', file: '.hopak/data.db' }`;
  }
  return `database: { dialect: '${dialect}', url: process.env.DATABASE_URL }`;
}

function envExampleFor(dialect: DbDialect): string {
  if (dialect === 'sqlite') return '# Add secrets here\n';
  const placeholder = URL_PLACEHOLDERS[dialect];
  return `# Add secrets here\nDATABASE_URL=${placeholder}\n`;
}

function readmeFor(name: string, dialect: DbDialect): string {
  const bootstrap =
    dialect === 'sqlite'
      ? '```bash\nhopak dev\n```'
      : `Copy \`.env.example\` to \`.env\` and set \`DATABASE_URL\`, then:

\`\`\`bash
hopak sync   # create tables
hopak dev
\`\`\``;
  return `# ${name}\n\nBuilt with Hopak.js.\n\n## Run\n\n${bootstrap}\n`;
}

export function projectTemplate(
  name: string,
  options: ProjectTemplateOptions = {},
): ProjectTemplate {
  const dialect: DbDialect = options.dialect ?? 'sqlite';
  const driver = DRIVER_VERSIONS[dialect];

  const dependencies: Record<string, string> = { '@hopak/core': 'latest' };
  if (driver) dependencies[driver.pkg] = driver.version;

  return {
    name,
    files: {
      'package.json': JSON.stringify(
        {
          name,
          version: '0.0.1',
          private: true,
          type: 'module',
          scripts: {
            dev: 'hopak dev',
            start: 'bun run main.ts',
          },
          dependencies,
          devDependencies: {
            '@hopak/cli': 'latest',
          },
        },
        null,
        2,
      ),
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            resolveJsonModule: true,
            types: ['bun'],
          },
          include: ['app', 'main.ts', 'hopak.config.ts'],
        },
        null,
        2,
      ),
      'main.ts': `import { hopak } from '@hopak/core';\n\nawait hopak().listen();\n`,
      'hopak.config.ts': `import { defineConfig } from '@hopak/core';

// Switch dialects with one CLI command — \`hopak use\` rewrites this block:
//   hopak use sqlite
//   hopak use postgres
//   hopak use mysql
//
// Enable HTTPS in dev — run \`hopak generate cert\` once to create
// .hopak/certs/dev.{key,crt}, then:
//   server: { https: { enabled: true, port: 3443 } },

export default defineConfig({
  server: { port: 3000 },
  ${databaseConfigBlock(dialect)},
});
`,
      '.gitignore': 'node_modules\n.hopak\n*.log\n.env\n.env.local\n',
      '.env.example': envExampleFor(dialect),
      'README.md': readmeFor(name, dialect),
      'app/models/post.ts': `import { model, text, boolean } from '@hopak/core';

export default model('post', {
  title: text().required().min(3).max(200),
  content: text().required(),
  published: boolean().default(false),
});
`,
      'app/routes/api/posts.ts': crudCollectionTemplate('post', '../../models/post'),
      'app/routes/api/posts/[id].ts': crudItemTemplate('post', '../../../models/post'),
      'app/routes/index.ts': `import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: () => ({ message: 'Welcome to ${name}' }),
});
`,
      'public/.gitkeep': '',
    },
  };
}

export function modelTemplate(name: string): string {
  return `import { model, text } from '@hopak/core';

export default model('${name}', {
  name: text().required(),
});
`;
}

export function routeTemplate(): string {
  return `import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
`;
}

/**
 * `<routesDir>/api/<plural>.ts` — list + create. `importPath` is the
 * relative path (without `.ts`) from the route file to the model file,
 * computed from `config.paths` so custom layouts work out of the box.
 */
export function crudCollectionTemplate(modelName: string, importPath: string): string {
  return `import { crud } from '@hopak/core';
import ${modelName} from '${importPath}';

export const GET = crud.list(${modelName});
export const POST = crud.create(${modelName});
`;
}

/**
 * `<routesDir>/api/<plural>/[id].ts` — read / update / patch / delete.
 */
export function crudItemTemplate(modelName: string, importPath: string): string {
  return `import { crud } from '@hopak/core';
import ${modelName} from '${importPath}';

export const GET = crud.read(${modelName});
export const PUT = crud.update(${modelName});
export const PATCH = crud.patch(${modelName});
export const DELETE = crud.remove(${modelName});
`;
}

export interface CrudPathsOptions {
  /** Absolute path to the routes directory (config.paths.routes). */
  readonly routesDir: string;
  /** Absolute path to the models directory (config.paths.models). */
  readonly modelsDir: string;
}

export function crudRoutesFor(
  modelName: string,
  paths: CrudPathsOptions,
): {
  collection: { path: string; contents: string };
  item: { path: string; contents: string };
} {
  const plural = pluralize(modelName);
  const collectionPath = join(paths.routesDir, 'api', `${plural}.ts`);
  const itemPath = join(paths.routesDir, 'api', plural, '[id].ts');
  const modelPath = join(paths.modelsDir, modelName);
  const toImport = (from: string) => {
    const rel = relative(dirname(from), modelPath);
    const pretty = rel.split(/[\\/]/).join(posix.sep);
    return pretty.startsWith('.') ? pretty : `./${pretty}`;
  };
  return {
    collection: {
      path: collectionPath,
      contents: crudCollectionTemplate(modelName, toImport(collectionPath)),
    },
    item: {
      path: itemPath,
      contents: crudItemTemplate(modelName, toImport(itemPath)),
    },
  };
}
