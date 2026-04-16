import { FieldBuilder, type FieldType } from './base';

export class StringField<TRequired extends boolean = false> extends FieldBuilder<
  string,
  TRequired
> {
  required(): StringField<true> {
    return this.markAs<StringField<true>>(true);
  }

  optional(): StringField<false> {
    return this.markAs<StringField<false>>(false);
  }

  default(value: string): this {
    this.def.default = value;
    return this;
  }

  min(length: number): this {
    this.def.min = length;
    return this;
  }

  max(length: number): this {
    this.def.max = length;
    return this;
  }

  pattern(regex: RegExp | string): this {
    this.def.pattern = typeof regex === 'string' ? regex : regex.source;
    return this;
  }
}

const stringFactory = (type: FieldType) => (): StringField<false> => new StringField(type);

export const text = stringFactory('text');
export const email = stringFactory('email');
export const url = stringFactory('url');
export const phone = stringFactory('phone');

export class SecretField<TRequired extends boolean = false> extends StringField<TRequired> {
  constructor(type: FieldType) {
    super(type);
    this.def.excludeFromJson = true;
  }

  override required(): SecretField<true> {
    return this.markAs<SecretField<true>>(true);
  }

  override optional(): SecretField<false> {
    return this.markAs<SecretField<false>>(false);
  }
}

const secretFactory = (type: FieldType) => (): SecretField<false> => new SecretField(type);

export const password = secretFactory('password');
export const secret = secretFactory('secret');
export const token = secretFactory('token');
