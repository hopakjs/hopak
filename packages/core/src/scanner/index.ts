import { resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { Glob } from 'bun';
import { errorMessage } from '../internal/errors';
import type { ModelDefinition } from '../model/define';
import type { ModelRegistry } from '../model/registry';

const MODEL_GLOB = '**/*.{ts,js,mjs}';

export interface ScannerOptions {
  modelsDir: string;
  registry: ModelRegistry;
  log?: Logger;
}

export interface ScanResult {
  models: number;
  files: string[];
  errors: ScanError[];
}

export interface ScanError {
  file: string;
  message: string;
  cause?: unknown;
}

function isModelDefinition(value: unknown): value is ModelDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'fields' in value &&
    '__fields' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

export class Scanner {
  private readonly modelsDir: string;
  private readonly registry: ModelRegistry;
  private readonly log: Logger | undefined;

  constructor(options: ScannerOptions) {
    this.modelsDir = resolve(options.modelsDir);
    this.registry = options.registry;
    this.log = options.log;
  }

  async scanModels(): Promise<ScanResult> {
    const result: ScanResult = { models: 0, files: [], errors: [] };

    if (!(await pathExists(this.modelsDir))) {
      this.log?.debug('Models directory does not exist, skipping scan', {
        path: this.modelsDir,
      });
      return result;
    }

    const glob = new Glob(MODEL_GLOB);
    for await (const relative of glob.scan({ cwd: this.modelsDir })) {
      const fullPath = resolve(this.modelsDir, relative);
      result.files.push(fullPath);
      await this.loadFile(fullPath, result);
    }

    return result;
  }

  private async loadFile(fullPath: string, result: ScanResult): Promise<void> {
    try {
      const mod = (await import(fullPath)) as Record<string, unknown>;
      if (isModelDefinition(mod.default)) {
        this.registry.register(mod.default);
        result.models += 1;
        this.log?.debug('Registered model', { name: mod.default.name, file: fullPath });
        return;
      }

      // No default model — file's just a helper module co-located with
      // real models. Fine, unless it exports a model() under a non-default
      // name, which is almost always an oversight.
      for (const [name, value] of Object.entries(mod)) {
        if (name !== 'default' && isModelDefinition(value)) {
          this.log?.warn(
            `${fullPath}: model() exported as "${name}" — rename to default export to register it.`,
          );
          break;
        }
      }
    } catch (cause) {
      const message = errorMessage(cause);
      result.errors.push({ file: fullPath, message, cause });
      this.log?.error('Failed to load model file', { file: fullPath, error: message });
    }
  }
}
