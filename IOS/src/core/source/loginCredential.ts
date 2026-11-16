/**
 * Android source: `com.example.source.LoginCredential.kt`
 */

export interface LoginCredential {
  readonly username: string;
  readonly password: string;
  readonly cookie: string | null;
  readonly extraData: Record<string, string>;
}

export function createLoginCredential(params: {
  username?: string;
  password?: string;
  cookie?: string | null;
  extraData?: Record<string, string>;
} = {}): LoginCredential {
  return {
    username: params.username ?? '',
    password: params.password ?? '',
    cookie: params.cookie ?? null,
    extraData: params.extraData ?? {},
  };
}
