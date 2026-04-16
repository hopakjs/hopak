import { ScalarField } from './scalar';

export class EnumField<
  TValues extends readonly string[],
  TRequired extends boolean = false,
> extends ScalarField<TValues[number], TRequired> {
  constructor(values: TValues) {
    super('enum', { enumValues: values });
  }

  override required(): EnumField<TValues, true> {
    return this.markAs<EnumField<TValues, true>>(true);
  }

  override optional(): EnumField<TValues, false> {
    return this.markAs<EnumField<TValues, false>>(false);
  }
}

export const enumOf = <T extends readonly string[]>(...values: T): EnumField<T, false> =>
  new EnumField(values);
