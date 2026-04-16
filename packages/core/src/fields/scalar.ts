import { FieldBuilder } from './base';

export class ScalarField<TValue, TRequired extends boolean = false> extends FieldBuilder<
  TValue,
  TRequired
> {
  required(): ScalarField<TValue, true> {
    return this.markAs<ScalarField<TValue, true>>(true);
  }

  optional(): ScalarField<TValue, false> {
    return this.markAs<ScalarField<TValue, false>>(false);
  }

  default(value: TValue): this {
    this.def.default = value;
    return this;
  }
}

export const boolean = (): ScalarField<boolean, false> => new ScalarField<boolean>('boolean');
export const json = <TShape = unknown>(): ScalarField<TShape, false> =>
  new ScalarField<TShape>('json');

export class DateField<TRequired extends boolean = false> extends ScalarField<Date, TRequired> {
  override required(): DateField<true> {
    return this.markAs<DateField<true>>(true);
  }

  override optional(): DateField<false> {
    return this.markAs<DateField<false>>(false);
  }

  override default(value: Date | 'now'): this {
    this.def.default = value;
    return this;
  }

  onUpdate(value: 'now'): this {
    this.def.default = value;
    return this;
  }
}

export const date = (): DateField<false> => new DateField('date');
export const timestamp = (): DateField<false> => new DateField('timestamp');
