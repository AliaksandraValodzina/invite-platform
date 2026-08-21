import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EOL } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'
import { describe, expect, it } from 'vitest'

/**
 * `next dev` maintains tsconfig.json, and it rewrites the whole file whenever it
 * changes one thing in it. Its serializer puts every array element on its own
 * line; Prettier keeps short arrays on one line. Committing the Prettier shape
 * meant the first write Next made reformatted the entire file, and the dirty
 * file then blocked `git pull` until somebody discarded it by hand.
 *
 * So the committed bytes are Next's own output, Prettier is told to leave the
 * file alone, and this test holds both halves. The second case is the one that
 * matters after a Next upgrade: if a new version wants an option the file does
 * not have, this goes red in CI instead of appearing as an uncommitted change
 * in everybody's tree.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')

const require = createRequire(join(repoRoot, 'node_modules/'))
const commentJson = require('next/dist/compiled/comment-json') as {
  parse: (source: string) => unknown
  stringify: (value: unknown, replacer: null, space: number) => string
}
const { writeConfigurationDefaults } =
  require('next/dist/lib/typescript/writeConfigurationDefaults') as {
    writeConfigurationDefaults: (
      typescriptVersion: string,
      tsConfigPath: string,
      isFirstTimeSetup: boolean,
      hasAppDir: boolean,
      distDir: string,
      hasPagesDir: boolean,
      strictRouteTypes: boolean
    ) => Promise<void>
  }
const typescriptVersion = (require('typescript') as { version: string }).version

const committed = readFileSync(tsconfigPath, 'utf8')

/**
 * The parameters Next itself passes. `next dev` runs it from
 * setup-dev-bundler with the dev dist dir, `next build` and `next typegen` with
 * the build one, and the type glob patterns it wants differ between the two.
 */
const invocations = [
  { name: 'next dev', nodeEnv: 'development', distDir: '.next/dev' },
  { name: 'next build', nodeEnv: 'production', distDir: '.next' },
] as const

async function runWriter(nodeEnv: string, distDir: string): Promise<string> {
  const copy = join(mkdtempSync(join(tmpdir(), 'tsconfig-shape-')), 'tsconfig.json')
  copyFileSync(tsconfigPath, copy)

  // The writer reads NODE_ENV directly to decide which type globs it wants, so
  // the environment is part of the invocation being reproduced here.
  const env = process.env as Record<string, string | undefined>
  const previous = env.NODE_ENV
  env.NODE_ENV = nodeEnv
  try {
    await writeConfigurationDefaults(typescriptVersion, copy, false, true, distDir, false, false)
  } finally {
    env.NODE_ENV = previous
  }

  return readFileSync(copy, 'utf8')
}

describe('tsconfig.json is written in the shape Next.js produces', () => {
  it('is byte identical to its own round trip through Next.js serializer', () => {
    const roundTripped = commentJson.stringify(commentJson.parse(committed), null, 2) + EOL

    // Not `toEqual` on the parsed objects: the values were never the problem.
    // Whitespace is the whole bug.
    expect(committed).toBe(roundTripped)
  })

  for (const { name, distDir, nodeEnv } of invocations) {
    it(`is left untouched by the writer ${name} runs`, async () => {
      expect(await runWriter(nodeEnv, distDir)).toBe(committed)
    })
  }

  it('is ignored by Prettier, so the two formatters cannot fight over it', async () => {
    const info = await prettier.getFileInfo(tsconfigPath, {
      ignorePath: join(repoRoot, '.prettierignore'),
    })

    expect(info.ignored).toBe(true)
  })
})
