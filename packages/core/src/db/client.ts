export interface FindManyOptions {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
}

export type Id = number | string;

export interface ModelClient<TRow = Record<string, unknown>> {
  findMany(options?: FindManyOptions): Promise<TRow[]>;
  findOne(id: Id): Promise<TRow | null>;
  findOrFail(id: Id): Promise<TRow>;
  count(options?: Pick<FindManyOptions, 'where'>): Promise<number>;
  create(data: Partial<TRow>): Promise<TRow>;
  update(id: Id, data: Partial<TRow>): Promise<TRow>;
  delete(id: Id): Promise<boolean>;
}

export interface Database {
  model<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): ModelClient<TRow>;
  raw(): unknown;
  sync(): Promise<void>;
  close(): Promise<void>;
}
