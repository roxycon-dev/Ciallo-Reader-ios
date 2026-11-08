/**
 * Android source: `com.example.source.AuthenticationState.kt`
 * Kotlin sealed interface + objects → const object + string union.
 */

export const AuthenticationState = {
  NotRequired: 'NotRequired',
  Required: 'Required',
  Authenticated: 'Authenticated',
  Expired: 'Expired',
} as const;

export type AuthenticationState =
  (typeof AuthenticationState)[keyof typeof AuthenticationState];
