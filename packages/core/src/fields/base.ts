export type FieldType =
  | 'text'
  | 'email'
  | 'url'
  | 'phone'
  | 'number'
  | 'money'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'json'
  | 'enum'
  | 'belongsTo'
  | 'hasMany'
  | 'hasOne'
  | 'password'
  | 'secret'
  | 'token'
  | 'file'
  | 'image';

/**
 * Built-in types are a closed union for exhaustive handling inside core;
 * plugins register additional types as plain strings via
 * `PluginContext.registerField`, so the definition carries the widened
 * form. The `string & {}` trick keeps literal autocomplete working.
 */
export type AnyFieldType = FieldType | (string & {});

export interface FieldDefinition {
  type: AnyFieldType;
  required: boolean;
  unique?: boolean;
  index?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  enumValues?: readonly string[];
  relationTarget?: string;
  excludeFromJson?: boolean;
}

export abstract class FieldBuilder<TValue, TRequired extends boolean = false> {
  declare readonly __value: TValue;
  declare readonly __required: TRequired;

  protected readonly def: FieldDefinition;

  constructor(type: AnyFieldType, init?: Partial<FieldDefinition>) {
    this.def = { type, required: false, ...init };
  }

  unique(): this {
    this.def.unique = true;
    return this;
  }

  index(): this {
    this.def.index = true;
    return this;
  }

  build(): FieldDefinition {
    return { ...this.def };
  }

  /**
   * Single point where the `TRequired` phantom type is flipped. Subclasses
   * declare narrowed `required()` / `optional()` return types and delegate
   * here. The cast lives in this one helper rather than in every subclass.
   *
   * `markAs` mutates the underlying definition and retypes `this` to whatever
   * the caller asks for via the type parameter.
   */
  protected markAs<TBuilder>(required: boolean): TBuilder {
    this.def.required = required;
    return this as unknown as TBuilder;
  }
}

export type InferFieldValue<F> = F extends FieldBuilder<infer V, infer R>
  ? R extends true
    ? V
    : V | undefined
  : never;

export type InferFields<T extends Record<string, FieldBuilder<unknown, boolean>>> = {
  [K in keyof T]: InferFieldValue<T[K]>;
};
