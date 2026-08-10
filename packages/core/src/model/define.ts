import type { Id } from '../db/client';
import type { FieldBuilder, FieldDefinition, InferFields } from '../fields/base';

/**
 * Lifecycle hooks around single-row writes. `before*` hooks may return a
 * replacement payload (or mutate and return nothing); `after*` hooks are
 * side-effect only. Bulk operations (`createMany` / `updateMany` /
 * `deleteMany`) skip hooks — they translate to a single SQL statement.
 *
 * Declared as methods so a `ModelHooks<Post>` fits the untyped
 * `ModelHooks` slot on `ModelDefinition`.
 */
export interface ModelHooks<TRow = Record<string, unknown>> {
  beforeCreate?(
    data: Partial<TRow>,
  ): Partial<TRow> | undefined | void | Promise<Partial<TRow> | undefined | void>;
  afterCreate?(row: TRow): void | Promise<void>;
  beforeUpdate?(
    data: Partial<TRow>,
    id: Id,
  ): Partial<TRow> | undefined | void | Promise<Partial<TRow> | undefined | void>;
  afterUpdate?(row: TRow): void | Promise<void>;
  beforeDelete?(id: Id): void | Promise<void>;
  afterDelete?(id: Id): void | Promise<void>;
}

export interface ModelOptions {
  /** Emit `created_at` + `updated_at` columns (default: true). */
  timestamps?: boolean;
}

type AnyFieldMap = Record<string, FieldBuilder<unknown, boolean>>;

export interface ModelDefinition<TFields extends AnyFieldMap = AnyFieldMap> {
  readonly name: string;
  readonly fields: { [K in keyof TFields]: FieldDefinition };
  readonly options: Required<ModelOptions>;
  readonly hooks?: ModelHooks;
  readonly __fields: TFields;
}

export function model<TFields extends AnyFieldMap>(
  name: string,
  fields: TFields,
  options: ModelOptions & { hooks?: ModelHooks<InferFields<TFields>> } = {},
): ModelDefinition<TFields> {
  const built = Object.fromEntries(
    Object.entries(fields).map(([key, builder]) => [key, builder.build()]),
  ) as { [K in keyof TFields]: FieldDefinition };

  const { hooks, ...rest } = options;
  return {
    name,
    fields: built,
    options: { timestamps: true, ...rest },
    ...(hooks ? { hooks: hooks as ModelHooks } : {}),
    __fields: fields,
  };
}

export type InferRow<M> = M extends ModelDefinition<infer F> ? InferFields<F> : never;
