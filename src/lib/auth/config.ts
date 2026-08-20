/**
 * What the auth calls need, and the only names they read.
 *
 * The publishable (anon) key, not the service role key. It is the key a browser
 * would carry, it grants nothing on its own because every table revokes `anon`
 * at three layers, and it is the key the auth API expects for a sign-in. The
 * service role key never appears on this path: an endpoint that mints a session
 * is not one to hold a key that bypasses row level security.
 *
 * Strict, and it throws, for the same reason `src/lib/supabase/service.ts`
 * does. `src/lib/env.ts` is the module that must never throw, because a build
 * with no variables set has to succeed; a request that is about to sign somebody
 * in has to fail loudly when it cannot.
 */

export type AuthConfig = {
  /** Origin of the Supabase API, no trailing slash. */
  readonly url: string
  readonly anonKey: string
}

export const AUTH_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const

export function readAuthConfig(
  source: Record<string, string | undefined> = process.env
): AuthConfig {
  const missing = AUTH_ENV_KEYS.filter((key) => (source[key] ?? '').trim() === '')

  if (missing.length > 0) {
    throw new Error(
      `signing in needs ${missing.join(' and ')}. ` +
        'Set them in the environment for this deployment. Locally, `supabase status` prints ' +
        'both for the CLI stack, and they belong in .env.local, which is git ignored. ' +
        'See .env.example.'
    )
  }

  const raw = (source.SUPABASE_URL ?? '').trim()
  let origin: string
  try {
    origin = new URL(raw).origin
  } catch {
    throw new Error(
      `SUPABASE_URL must be an absolute URL such as http://127.0.0.1:54321, got "${raw}"`
    )
  }

  return { url: origin, anonKey: (source.SUPABASE_ANON_KEY ?? '').trim() }
}
