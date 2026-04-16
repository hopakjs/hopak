import { FieldBuilder, type FieldType } from './base';

export class NumberField<TRequired extends boolean = false> extends FieldBuilder<
  number,
  TRequired
> {
  required(): NumberField<true> {
    return this.markAs<NumberField<true>>(true);
  }

  optional(): NumberField<false> {
    return this.markAs<NumberField<false>>(false);
  }

  default(value: number): this {
    this.def.default = value;
    return this;
  }

  min(value: number): this {
    this.def.min = value;
    return this;
  }

  max(value: number): this {
    this.def.max = value;
    return this;
  }
}

const numberFactory = (type: FieldType) => (): NumberField<false> => new NumberField(type);

export const number = numberFactory('number');
export const money = numberFactory('money');
