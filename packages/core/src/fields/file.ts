import type { FieldType } from './base';
import { ScalarField } from './scalar';

export interface FileMeta {
  url: string;
  mimeType: string;
  size: number;
  name?: string;
}

const FILE_SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

function parseFileSize(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid file size: ${input}. Expected formats: 100B, 5KB, 10MB, 1GB`);
  }
  const multiplier = FILE_SIZE_UNITS[match[2].toUpperCase()];
  if (multiplier === undefined) {
    throw new Error(`Unknown file size unit: ${match[2]}`);
  }
  return Math.round(Number(match[1]) * multiplier);
}

export class FileField<TRequired extends boolean = false> extends ScalarField<FileMeta, TRequired> {
  override required(): FileField<true> {
    return this.markAs<FileField<true>>(true);
  }

  override optional(): FileField<false> {
    return this.markAs<FileField<false>>(false);
  }

  maxSize(value: string | number): this {
    this.def.max = typeof value === 'number' ? value : parseFileSize(value);
    return this;
  }
}

const fileFactory = (type: FieldType) => (): FileField<false> => new FileField(type);

export const file = fileFactory('file');
export const image = fileFactory('image');
