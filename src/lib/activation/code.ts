/**
 * What an activation code is made of, on both sides of the line.
 *
 * The issuing script mints one and prints it once; the claim route reads one
 * out of a URL. Both need the same alphabet and the same idea of what a code
 * looks like, so both import this. It has no imports of its own, which is what
 * lets `scripts/issue-codes.ts` reach it by file name without a build step.
 *
 * ## The code is the link
 *
 * The captain's decision on 2026-08-23 is that a buyer clicks a link and never
 * types a code. That is a presentation choice over the model in
 * `20260819010700_activation_codes.sql`, not a change to it: a code is already
 * "a bearer token: whoever has the string can claim a paid activation", and a
 * URL is a way of carrying a string.
 *
 * So the same string does both jobs. `hash_activation_code` in the database
 * strips every non-alphanumeric character and uppercases before hashing, which
 * means the dashes below are decoration: `/claim/AB4C-D9EF-...` and `ab4cd9ef...`
 * are the same code. The dashes exist for the one case where a link fails and
 * somebody has to read the thing out.
 *
 * ## The alphabet
 *
 * Crockford's base32, which already leaves out the four characters that get
 * misread aloud and mistyped: I, L, O and U. Thirty-two symbols is five bits
 * each exactly, so a 20 character code carries 100 bits. That is the number
 * that matters, because a claim URL is guessable in exactly the way a password
 * is and this is not a code anybody brute forces.
 *
 * `code_prefix` in the database is the first four characters in the clear, and
 * that is why the alphabet is the uppercase set: the column's own constraint is
 * `^[A-Z0-9]{4}$`.
 */

/** Crockford's base32: digits and letters, without I, L, O or U. */
export const ACTIVATION_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Characters in a code, before any dashes are added. */
export const ACTIVATION_CODE_LENGTH = 20

/** How many characters between the dashes in the readable form. */
export const ACTIVATION_CODE_GROUP = 5

/**
 * The normalised form: what the database hashes, and the only form worth
 * comparing two codes in.
 *
 * The same rule as `public.hash_activation_code`, and it is written twice on
 * purpose rather than shared: this copy exists to decide whether a URL segment
 * is worth a database round trip and to word a refusal, and the database's copy
 * is the one that decides what a code IS. `tests/unit/activation/code.test.ts`
 * holds the two to the same answer over the cases that differ.
 */
export function normaliseActivationCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/** `AB4CD` `9EFGH` ... , which is the form a human reads out. */
export function formatActivationCode(value: string): string {
  const normalised = normaliseActivationCode(value)
  const groups: string[] = []
  for (let at = 0; at < normalised.length; at += ACTIVATION_CODE_GROUP) {
    groups.push(normalised.slice(at, at + ACTIVATION_CODE_GROUP))
  }
  return groups.join('-')
}

/** The four characters `activation_codes.code_prefix` keeps in the clear. */
export function activationCodePrefix(value: string): string {
  return normaliseActivationCode(value).slice(0, 4)
}

/**
 * Whether a string is shaped like a code this deployment mints.
 *
 * A cheap gate in front of the database, and nothing more: a code that passes
 * this is still almost certainly not a real one. It exists so that a crawler
 * walking `/claim/<anything>` does not turn into a query per request, and so
 * the claim page can say "that is not a claim link" rather than "that link has
 * been used", which are different sentences to somebody who just paid.
 */
export function isPossibleActivationCode(value: string): boolean {
  const normalised = normaliseActivationCode(value)
  if (normalised.length !== ACTIVATION_CODE_LENGTH) return false
  return [...normalised].every((symbol) => ACTIVATION_CODE_ALPHABET.includes(symbol))
}

/**
 * A code from random bytes.
 *
 * The bytes come from the caller so this module keeps no imports and so the
 * issuing script is the only thing that decides where randomness comes from.
 * The rejection loop rejects nothing today, because 256 is a whole number of
 * 32s. It is here anyway: an alphabet that stops being a power of two would
 * otherwise make the first symbols in it likelier than the rest, and a code
 * quietly carrying less entropy than the comment above claims is exactly the
 * kind of thing nobody notices.
 */
export function activationCodeFromBytes(bytes: Uint8Array): string {
  const size = ACTIVATION_CODE_ALPHABET.length
  const ceiling = Math.floor(256 / size) * size
  let code = ''

  for (const byte of bytes) {
    if (byte >= ceiling) continue
    code += ACTIVATION_CODE_ALPHABET[byte % size]
    if (code.length === ACTIVATION_CODE_LENGTH) return code
  }

  throw new Error(
    `ran out of random bytes after ${code.length} of ${ACTIVATION_CODE_LENGTH} characters`
  )
}

/** How many bytes to draw so `activationCodeFromBytes` finishes, with room to spare. */
export const ACTIVATION_CODE_BYTES = ACTIVATION_CODE_LENGTH * 4

/**
 * Where a claim link points, as a path.
 *
 * A path and not a URL, because the product has no name yet and therefore no
 * final host. Everything that needs an absolute link builds it from
 * `NEXT_PUBLIC_SITE_URL` through `readSiteConfig`, and `claimUrl` below is the
 * only place the two are joined.
 */
export function claimPath(code: string): string {
  return `/claim/${formatActivationCode(code)}`
}

/** The absolute link that goes into an Etsy delivery message. */
export function claimUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, '')}${claimPath(code)}`
}

/** Where a template preview points. Public, and meant to spread. */
export function templatePreviewPath(templateId: string): string {
  return `/t/${templateId}`
}

export function templatePreviewUrl(siteUrl: string, templateId: string): string {
  return `${siteUrl.replace(/\/$/, '')}${templatePreviewPath(templateId)}`
}

/**
 * Where the open copy link points, as a path.
 *
 * One segment below the preview, because it is the same template seen from the
 * other side, and a separate route because everything about it is the opposite:
 * the preview is public, cached and indexed, and this is signed in, dynamic and
 * `private, no-store` (src/proxy.ts).
 *
 * It is a destination a magic link may be sent to, so `safeDestination` in
 * src/lib/auth/destination.ts holds a pattern that must keep matching what this
 * builds. tests/unit/auth/destination.test.ts is where the two are held
 * together.
 *
 * Temporary by decision. This route belongs to the free launch and must be
 * replaced before the first paid listing publishes. See src/lib/activation/copy.ts.
 */
export function templateCopyPath(templateId: string): string {
  return `${templatePreviewPath(templateId)}/use`
}
