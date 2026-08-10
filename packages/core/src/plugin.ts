import { type HopakConfig, type Logger, PluginError } from '@hopak/common';
import { type FieldAdapter, registerFieldAdapter } from './fields/adapters';
import type { After, Before, Middleware, Wrap } from './http/middleware';

/**
 * Extension contract. A plugin is a named object whose `setup` runs once
 * during app boot, before models are scanned — so a field type registered
 * here is available to every model file. Register with
 * `hopak().use(plugin)`.
 */
export interface HopakPlugin {
  readonly name: string;
  setup(ctx: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  readonly config: Readonly<HopakConfig>;
  readonly log: Logger;
  /**
   * Register a custom field type. Ship a matching `FieldBuilder` subclass
   * from the plugin package so models get typed builders:
   *
   *   ctx.registerField('uuid', uuidAdapter);
   *   export const uuid = () => new UuidField();
   */
  registerField(type: string, adapter: FieldAdapter): void;
  /** Add global middleware — runs before middleware added via `hopak().before()`. */
  before(...fns: Before[]): void;
  after(...fns: After[]): void;
  wrap(...fns: Wrap[]): void;
  /** Run after every plugin's `setup` has completed, before routes load. */
  onBoot(hook: () => void | Promise<void>): void;
}

export interface PluginRuntime {
  readonly middleware: Middleware;
  readonly bootHooks: readonly (() => void | Promise<void>)[];
}

export async function setupPlugins(
  plugins: readonly HopakPlugin[],
  config: HopakConfig,
  log: Logger,
): Promise<PluginRuntime> {
  const before: Before[] = [];
  const after: After[] = [];
  const wrap: Wrap[] = [];
  const bootHooks: (() => void | Promise<void>)[] = [];
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (!plugin.name) {
      throw new PluginError('Plugin is missing a name. Every plugin needs a unique `name`.');
    }
    if (seen.has(plugin.name)) continue;
    seen.add(plugin.name);

    const ctx: PluginContext = {
      config,
      log,
      registerField(type, adapter) {
        registerFieldAdapter(type, adapter, plugin.name);
      },
      before(...fns) {
        before.push(...fns);
      },
      after(...fns) {
        after.push(...fns);
      },
      wrap(...fns) {
        wrap.push(...fns);
      },
      onBoot(hook) {
        bootHooks.push(hook);
      },
    };
    await plugin.setup(ctx);
  }

  return { middleware: { before, after, wrap }, bootHooks };
}
