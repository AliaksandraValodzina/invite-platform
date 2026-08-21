/**
 * The three uses, as one table.
 *
 * Buyer photographs, the one music file and the envelope artwork are the same
 * capability wearing three hats. Each needs somewhere to put bytes, a size
 * limit, a list of formats we accept, and a rule about who answers for the
 * content. Built three times they would differ three ways, and the difference
 * nobody would notice is the one in the retention schedule.
 *
 * So there is one row per kind here and nothing anywhere else knows how many
 * images an event may hold. `20260821010300_uploads.sql` carries the same
 * numbers in `public.upload_kind_cap` and enforces them in a trigger, because a
 * check in a route can be raced by two uploads in flight and can be forgotten
 * by the next route that writes to the table. This module is the copy that lets
 * a buyer be refused with a sentence instead of a stack trace, and
 * `tests/unit/uploads/limits.test.ts` reads the migration and fails when the
 * two stop agreeing.
 *
 * The captain's numbers, 2026-08-20: 30 images, 1 audio file, 1 envelope image
 * per event, and 10 MB accepted per file.
 *
 * On the 10 MB. It is what we ACCEPT, not what we store. A photograph straight
 * off a phone is 3 to 8 MB and refusing it is a support ticket, so the cap is
 * set above what a phone produces and every image is re-encoded on arrival. The
 * number that decides the bill is the per event variant budget below, which
 * bounds what is stored and served rather than what is offered.
 */

export const UPLOAD_KINDS = ['image', 'audio', 'envelope'] as const

export type UploadKind = (typeof UPLOAD_KINDS)[number]

/**
 * Bytes accepted per file, for every kind.
 *
 * Decimal megabytes, matching the number the terms page states, because a
 * buyer told "10 MB" and refused at 10,000,001 bytes has been told the truth
 * and a buyer refused at 9,600,000 has not.
 */
export const UPLOAD_MAX_BYTES = 10_000_000

/**
 * Bytes an event may have STORED and SERVED, across every kind.
 *
 * This is the cap that matters commercially: uploads are re-encoded on arrival,
 * so it bounds egress and storage rather than politeness. 30 images at three
 * WebP widths land around a third of it, which is the headroom the audio file
 * needs.
 */
export const UPLOAD_EVENT_VARIANT_BUDGET = 50_000_000

/** The widths a derivative may be generated at, largest last. */
export type VariantPlan = {
  /** Appears in the object key, so it is short and URL safe. */
  readonly label: string
  /** Absent for a kind that is stored as it arrived, which is audio. */
  readonly width?: number
}

export type UploadKindSpec = {
  readonly kind: UploadKind
  /** For a sentence a buyer reads. */
  readonly label: string
  /** How many live uploads of this kind one event may hold. */
  readonly perEvent: number
  /** Format names from `./formats`, and the only ones this kind accepts. */
  readonly accepts: readonly string[]
  /**
   * What re-encoding does to this kind.
   *
   * `image` means resize and re-encode to WebP at the widths below.
   * `none` means the bytes are stored as they arrived, which is audio: an
   * ffmpeg pipeline is real work, and 10 MB is about eleven minutes at
   * 128 kbps, which is longer than any invitation needs.
   */
  readonly encode: 'image' | 'none'
  readonly variants: readonly VariantPlan[]
}

export const UPLOAD_KIND_SPECS: Readonly<Record<UploadKind, UploadKindSpec>> = {
  /**
   * A buyer's photograph, placed in a block on the page.
   *
   * Three widths because a guest page is read on a phone at 320 to 430 CSS
   * pixels, usually at 2x or 3x, and on a laptop at up to 800. Below 480 the
   * file stops being the thing that costs anything; above 1600 nothing on this
   * page is ever drawn that large.
   */
  image: {
    kind: 'image',
    label: 'photo',
    perEvent: 30,
    accepts: ['jpeg', 'png', 'webp', 'avif'],
    encode: 'image',
    variants: [
      { label: 'w480', width: 480 },
      { label: 'w960', width: 960 },
      { label: 'w1600', width: 1600 },
    ],
  },

  /**
   * The music file. Stored as it arrived.
   *
   * Click to play, never autoplay, is a decision made elsewhere and for taste
   * reasons; it also happens to be the single largest line in the transfer
   * table, because an autoplaying 3 MB file is 3 MB on every visit whether
   * anybody wanted it or not.
   */
  audio: {
    kind: 'audio',
    label: 'music file',
    perEvent: 1,
    accepts: ['mp3', 'm4a'],
    encode: 'none',
    variants: [{ label: 'src' }],
  },

  /**
   * The envelope artwork, which is drawn full bleed behind the reveal.
   *
   * Two widths rather than three: it is one large decorative image and the
   * smallest of the three photo widths would be visibly soft at full bleed.
   */
  envelope: {
    kind: 'envelope',
    label: 'envelope artwork',
    perEvent: 1,
    accepts: ['jpeg', 'png', 'webp', 'avif'],
    encode: 'image',
    variants: [
      { label: 'w800', width: 800 },
      { label: 'w1600', width: 1600 },
    ],
  },
}

export function isUploadKind(value: string): value is UploadKind {
  return (UPLOAD_KINDS as readonly string[]).includes(value)
}
