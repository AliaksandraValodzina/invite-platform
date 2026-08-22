import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_CODE_ALPHABET,
  ACTIVATION_CODE_BYTES,
  ACTIVATION_CODE_LENGTH,
  activationCodeFromBytes,
  activationCodePrefix,
  claimPath,
  claimUrl,
  formatActivationCode,
  isPossibleActivationCode,
  normaliseActivationCode,
  templatePreviewUrl,
} from '@/lib/activation/code'

/**
 * The code format, and the two claims it makes about itself.
 *
 * One: a code in a URL and a code read out over the phone are the same code,
 * because `public.hash_activation_code` normalises before hashing. The
 * assertions below are the cases that differ, written the way the SQL is
 * written: strip everything that is not alphanumeric, then uppercase.
 *
 * Two: the alphabet is the one `activation_codes_code_prefix` will accept. A
 * mint that produced a lowercase or ambiguous character would fail on insert,
 * and it would fail on the day of an order rather than in CI.
 */

const SAMPLE = 'AB4CD9EFGHJKMNPQRSTV'

describe('normalising a code', () => {
  it('is the same string with the dashes in or out, in either case', () => {
    expect(normaliseActivationCode('ab4cd-9efgh-jkmnp-qrstv')).toBe(SAMPLE)
    expect(normaliseActivationCode('AB4CD9EFGHJKMNPQRSTV')).toBe(SAMPLE)
    expect(normaliseActivationCode('AB4CD 9EFGH JKMNP QRSTV')).toBe(SAMPLE)
    expect(normaliseActivationCode('ab4cd.9efgh/jkmnp_qrstv')).toBe(SAMPLE)
  })

  it('leaves nothing but letters and digits, which is what the database hashes', () => {
    expect(normaliseActivationCode('!@#$%^&*()')).toBe('')
  })
})

describe('the readable form', () => {
  it('groups into fives, which is what somebody reads out', () => {
    expect(formatActivationCode(SAMPLE)).toBe('AB4CD-9EFGH-JKMNP-QRSTV')
  })

  it('round trips: formatting then normalising gives the code back', () => {
    expect(normaliseActivationCode(formatActivationCode(SAMPLE))).toBe(SAMPLE)
  })

  it('takes the prefix from the normalised form, not from the dashed one', () => {
    expect(activationCodePrefix('ab4cd-9efgh-jkmnp-qrstv')).toBe('AB4C')
  })

  it('matches activation_codes_code_prefix, which is ^[A-Z0-9]{4}$', () => {
    expect(activationCodePrefix(SAMPLE)).toMatch(/^[A-Z0-9]{4}$/)
  })
})

describe('the alphabet', () => {
  it('leaves out the four characters that get misread: I, L, O and U', () => {
    for (const symbol of ['I', 'L', 'O', 'U']) {
      expect(ACTIVATION_CODE_ALPHABET).not.toContain(symbol)
    }
  })

  it('is entirely characters code_prefix will accept', () => {
    expect(ACTIVATION_CODE_ALPHABET).toMatch(/^[A-Z0-9]+$/)
  })
})

describe('minting from bytes', () => {
  it('produces a code of the stated length from the stated budget', () => {
    const bytes = new Uint8Array(ACTIVATION_CODE_BYTES)
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 256

    const code = activationCodeFromBytes(bytes)

    expect(code).toHaveLength(ACTIVATION_CODE_LENGTH)
    expect(isPossibleActivationCode(code)).toBe(true)
  })

  it('says so rather than returning a short code when the bytes run out', () => {
    expect(() => activationCodeFromBytes(new Uint8Array(3))).toThrow(/ran out of random bytes/)
  })

  it('draws every symbol of the alphabet, so none of it is unreachable', () => {
    /*
     * A modulo bug that dropped the tail of the alphabet would still produce
     * codes that look fine and pass every other assertion here. Walking every
     * byte value is what makes it visible.
     */
    const bytes = new Uint8Array(256)
    for (let at = 0; at < 256; at += 1) bytes[at] = at

    const seen = new Set<string>()
    for (const byte of bytes) {
      const one = activationCodeFromBytes(new Uint8Array(Array(ACTIVATION_CODE_LENGTH).fill(byte)))
      seen.add(one[0] as string)
    }

    expect(seen.size).toBe(ACTIVATION_CODE_ALPHABET.length)
  })
})

describe('recognising a claim link', () => {
  it('accepts what the minter produces, dashed or not', () => {
    expect(isPossibleActivationCode(SAMPLE)).toBe(true)
    expect(isPossibleActivationCode(formatActivationCode(SAMPLE))).toBe(true)
    expect(isPossibleActivationCode(SAMPLE.toLowerCase())).toBe(true)
  })

  it('refuses the wrong length, so a crawler costs no database query', () => {
    expect(isPossibleActivationCode('AB4CD')).toBe(false)
    expect(isPossibleActivationCode(`${SAMPLE}X`)).toBe(false)
    expect(isPossibleActivationCode('')).toBe(false)
  })

  it('refuses a character this alphabet never mints', () => {
    expect(isPossibleActivationCode(`I${SAMPLE.slice(1)}`)).toBe(false)
  })
})

describe('the two links', () => {
  it('builds the claim link from configuration and never from a literal host', () => {
    expect(claimPath(SAMPLE)).toBe('/claim/AB4CD-9EFGH-JKMNP-QRSTV')
    expect(claimUrl('https://example.test', SAMPLE)).toBe(
      'https://example.test/claim/AB4CD-9EFGH-JKMNP-QRSTV'
    )
  })

  it('does not double the slash when the configured origin carries one', () => {
    expect(claimUrl('https://example.test/', SAMPLE)).toBe(
      'https://example.test/claim/AB4CD-9EFGH-JKMNP-QRSTV'
    )
    expect(templatePreviewUrl('https://example.test/', 'abc')).toBe('https://example.test/t/abc')
  })

  it('keeps the preview link and the claim link on different routes', () => {
    // They are different powers held by different people: one renders a design
    // and creates nothing, the other spends a paid activation. A shared prefix
    // is how those two get confused for each other.
    expect(templatePreviewUrl('https://example.test', 'abc')).not.toContain('/claim/')
    expect(claimUrl('https://example.test', SAMPLE)).not.toContain('/t/')
  })
})
