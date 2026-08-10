import type { ModelDefinition } from '../model/define';
import type { Id, ModelClient } from './client';

/**
 * Wrap a ModelClient so the model's lifecycle hooks fire around
 * single-row writes. Applied at the `Database.model()` boundary — one
 * place per dialect — so every dialect (including MySQL's no-RETURNING
 * overrides) gets the same hook behavior. Models without hooks get the
 * bare client back, so the hot path pays nothing.
 */
export function withModelHooks<TRow extends Record<string, unknown>>(
  client: ModelClient<TRow>,
  modelDef: ModelDefinition,
): ModelClient<TRow> {
  const hooks = modelDef.hooks;
  if (!hooks) return client;

  const overrides = {
    async create(data: Partial<TRow>): Promise<TRow> {
      const prepared = ((await hooks.beforeCreate?.(data)) as Partial<TRow> | undefined) ?? data;
      const row = await client.create(prepared);
      await hooks.afterCreate?.(row);
      return row;
    },
    async update(id: Id, data: Partial<TRow>): Promise<TRow> {
      const prepared =
        ((await hooks.beforeUpdate?.(data, id)) as Partial<TRow> | undefined) ?? data;
      const row = await client.update(id, prepared);
      await hooks.afterUpdate?.(row);
      return row;
    },
    async delete(id: Id): Promise<boolean> {
      await hooks.beforeDelete?.(id);
      const removed = await client.delete(id);
      if (removed) await hooks.afterDelete?.(id);
      return removed;
    },
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop as keyof typeof overrides];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ModelClient<TRow>;
}
