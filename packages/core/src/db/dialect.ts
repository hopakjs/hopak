import type { ModelDefinition } from '../model/define';

export interface DialectOptions {
  models: readonly ModelDefinition[];
  url?: string;
  file?: string;
}
