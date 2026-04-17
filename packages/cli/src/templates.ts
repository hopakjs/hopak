export interface ProjectTemplate {
  name: string;
  files: Record<string, string>;
}

export function projectTemplate(name: string): ProjectTemplate {
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
          dependencies: {
            '@hopak/core': 'latest',
          },
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

export default defineConfig({
  server: { port: 3000 },
  database: { dialect: 'sqlite', file: '.hopak/data.db' },
  // Enable HTTPS in dev — a self-signed cert is generated on first boot:
  // server: { https: { enabled: true, port: 3443 } },
});
`,
      '.gitignore': 'node_modules\n.hopak\n*.log\n.env\n.env.local\n',
      '.env.example': '# Add secrets here\n',
      'README.md': `# ${name}\n\nBuilt with Hopak.js.\n\n## Run\n\n\`\`\`bash\nbun install\nhopak dev\n\`\`\`\n`,
      'app/models/post.ts': `import { model, text, boolean } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required().min(3).max(200),
    content: text().required(),
    published: boolean().default(false),
  },
  { crud: true },
);
`,
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

export default model(
  '${name}',
  {
    name: text().required(),
  },
  { crud: true },
);
`;
}

export function routeTemplate(): string {
  return `import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
`;
}
