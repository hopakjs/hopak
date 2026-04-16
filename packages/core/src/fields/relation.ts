import type { FieldType } from './base';
import { ScalarField } from './scalar';

export class RelationField<TValue, TRequired extends boolean = false> extends ScalarField<
  TValue,
  TRequired
> {
  constructor(type: FieldType, target: string) {
    super(type, { relationTarget: target });
  }

  override required(): RelationField<TValue, true> {
    return this.markAs<RelationField<TValue, true>>(true);
  }

  override optional(): RelationField<TValue, false> {
    return this.markAs<RelationField<TValue, false>>(false);
  }
}

export const belongsTo = (target: string): RelationField<number, false> =>
  new RelationField<number>('belongsTo', target);

export const hasOne = (target: string): RelationField<number, false> =>
  new RelationField<number>('hasOne', target);

export const hasMany = (target: string): RelationField<number[], false> =>
  new RelationField<number[]>('hasMany', target);
