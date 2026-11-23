/**
 * In-memory runtime secrets. Values are stored in a WeakMap so JSON.stringify,
 * structured clones, and accidental log dumps of the holder never see them.
 */

export interface RuntimeSecretValues {
  readonly adminAccessToken?: string;
  readonly userAccessToken?: string;
  readonly databaseUrl?: string;
}

const STORE = new WeakMap<object, RuntimeSecretValues>();

export class RuntimeSecretHolder {
  constructor(initial?: RuntimeSecretValues) {
    if (initial) STORE.set(this, Object.freeze({ ...initial }));
  }

  set(values: RuntimeSecretValues): void {
    STORE.set(this, Object.freeze({ ...values }));
  }

  get(): RuntimeSecretValues {
    return STORE.get(this) ?? Object.freeze({});
  }

  clear(): void {
    STORE.delete(this);
  }

  toJSON(): { adminAccessToken: string; userAccessToken: string; databaseUrl: string } {
    return {
      adminAccessToken: '[REDACTED]',
      userAccessToken: '[REDACTED]',
      databaseUrl: '[REDACTED]',
    };
  }
}
