export interface ReadOnlyQuery {
  readonly sql: string;
  readonly params?: ReadonlyArray<unknown>;
}

export interface ReadOnlyQueryResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface ReadOnlyDatabase {
  query(input: ReadOnlyQuery, timeoutMs: number): Promise<ReadOnlyQueryResult>;
}
