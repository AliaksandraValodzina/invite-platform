import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readServiceConfig } from '@/lib/supabase/service'

/**
 * The two claims this module makes, and neither is checkable by reading it.
 *
 * It is strict, where src/lib/env.ts is deliberately not. A build with no
 * variables set has to succeed, so the fallback lives there and the throw lives
 * here, and the throw has to name every variable at once so that setting up an
 * environment costs one failure rather than three.
 *
 * It is server only, and the enforcement is a module that throws rather than a
 * naming convention. That claim is asserted against the real file, in a real
 * Node process with no bundler conditions applied, which is the closest thing
 * to "what happens if this ends up in a client bundle" that a unit test can do.
 */

const PRESENT = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'a-service-role-key',
}

describe('readServiceConfig', () => {
  it('reads a configured environment', () => {
    expect(readServiceConfig(PRESENT)).toEqual({
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'a-service-role-key',
    })
  })

  it('names every missing variable in one message, not just the first', () => {
    expect(() => readServiceConfig({})).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('names only the one that is missing', () => {
    const message = messageFrom(() => readServiceConfig({ SUPABASE_URL: PRESENT.SUPABASE_URL }))

    expect(message).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(message).not.toContain('SUPABASE_URL and')
  })

  it('treats an empty or blank variable as missing, because a deploy sets those by accident', () => {
    expect(() => readServiceConfig({ ...PRESENT, SUPABASE_SERVICE_ROLE_KEY: '   ' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/
    )
  })

  it('reduces the URL to an origin, so a trailing slash cannot double up in a path', () => {
    expect(readServiceConfig({ ...PRESENT, SUPABASE_URL: 'https://example.test/rest/' }).url).toBe(
      'https://example.test'
    )
  })

  it('refuses a URL that is not absolute rather than building a request against nothing', () => {
    expect(() => readServiceConfig({ ...PRESENT, SUPABASE_URL: 'example.test' })).toThrow(
      /absolute URL/
    )
  })

  it('says where to find the values, because the first person to hit this is setting up', () => {
    expect(messageFrom(() => readServiceConfig({}))).toContain('supabase status')
  })
})

describe('the server only marker', () => {
  it('throws when the module is imported without the react-server condition', () => {
    const servicePath = fileURLToPath(
      new URL('../../../src/lib/supabase/service.ts', import.meta.url)
    )

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(servicePath)})`],
      { encoding: 'utf8' }
    )

    // A client bundle resolves `server-only` to a module whose only statement
    // is a throw. This is that resolution, in a process with no bundler in it.
    expect(result.status, result.stderr).not.toBe(0)
    expect(result.stderr).toContain('Server Component')
  })
})

function messageFrom(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to throw, and it did not')
}
