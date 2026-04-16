import type { FieldBuilder, FieldDefinition, InferFields } from '../fields/base';

export interface ModelOptions {
  owner?: string;
  publicRead?: boolean;
  auth?: boolean;
  timestamps?: boolean;
  softDelete?: boolean;
  crud?: boolean;
}

type AnyFieldMap = Record<string, FieldBuilder<unknown, boolean>>;

export interface ModelDefinition<TFields extends AnyFieldMap = AnyFieldMap> {
  readonly name: string;
  readonly fields: { [K in keyof TFields]: FieldDefinition };
  readonly options: Required<Pick<ModelOptions, 'timestamps' | 'crud'>> & ModelOptions;
  readonly __fields: TFields;
}

export function model<TFields extends AnyFieldMap>(
  name: string,
  fields: TFields,
  options: ModelOptions = {},
): ModelDefinition<TFields> {
  const built = Object.fromEntries(
    Object.entries(fields).map(([key, builder]) => [key, builder.build()]),
  ) as { [K in keyof TFields]: FieldDefinition };

  const resolvedOptions = {
    timestamps: true,
    crud: false,
    ...options,
  };

  return {
    name,
    fields: built,
    options: resolvedOptions,
    __fields: fields,
  };
}

export type InferRow<M> = M extends ModelDefinition<infer F> ? InferFields<F> : never;
