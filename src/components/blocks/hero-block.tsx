/**
 * The hero: decorative artwork, the eyebrow, the names, the line under them,
 * and optionally a photo.
 *
 * The artwork band is what makes the top of the page read as an invitation.
 * Everything about how it is drawn follows from it being decoration rather than
 * content:
 *
 *   - it carries `alt=""` and is hidden from assistive technology, so a screen
 *     reader reads the couple's real names once, in the theme's type, and never
 *     a transcription of somebody else's card;
 *   - nothing is ever drawn on top of it, so no text on this page has its
 *     contrast measured against a picture instead of against a token, and
 *     tests/unit/template/contrast.test.ts stays able to see every pairing the
 *     block set can produce;
 *   - it is fetched lazily and at low priority, because the names are what a
 *     guest is here to read and they must not queue behind a JPEG on the hotel
 *     wifi.
 *
 * The band and the lockup are one element with one wrapper each, and nothing
 * outside this block positions either of them. That is deliberate: the envelope
 * reveal the captain wants later has to be able to wrap this composition, clip
 * it and animate it as a unit.
 *
 * The headline is the page's `h1`. It is also the one piece of copy on the page
 * that is guaranteed to be as long as the buyer's names, and the measurements in
 * data/ip-design-directions/report.md say that "Alexandra & Christopher" set at
 * display size overflows 320px in all three directions.
 *
 * So the names block stacks, which is that report's first finding. It was caught
 * by rendering rather than by arithmetic: "Emma & Jake" fits on one line in
 * every direction, so the sample content hides the failure and a one line lockup
 * would have passed a smoke test and then broken on the first buyer with two
 * long names. Stacking is also the traditional stationery lockup, so the
 * constraint and the craft agree.
 *
 * The other recommendation in that finding, that display size should be fluid so
 * a long name scales itself down, is a change to the token schema rather than to
 * this file, and is deliberately not made here. See docs/blocks.md.
 */

import { Fragment } from 'react'

import type { HeroConfig } from '@/lib/template'
import { readAssetHostConfig, resolveAssetSrc } from '@/lib/uploads/host'

import { BlockSection } from './block-section'

/**
 * The joins a names lockup breaks on, longest first so that " and " is tried
 * before " a " could ever match part of it.
 *
 * This is presentation, not format. The headline stays one string in the block
 * config, because it is one piece of copy that a buyer types into one field in
 * the guided form, and splitting it into `nameOne` and `nameTwo` would put a
 * lockup decision into a document that every future theme has to live with. A
 * headline with no join in it, which is what a single name or a phrase is, is
 * rendered as it was written and wraps.
 */
const NAME_JOINS = [' and ', ' & ', ' + ']

/**
 * Splits a headline into the three lines of a stacked lockup: name, join, name.
 * Exported so the split is testable on its own rather than only through a
 * rendered page.
 */
export function stackNames(headline: string): string[] {
  for (const join of NAME_JOINS) {
    const at = headline.indexOf(join)
    if (at === -1) continue

    const before = headline.slice(0, at).trim()
    const after = headline.slice(at + join.length).trim()
    if (before.length === 0 || after.length === 0) continue

    // The join is split back out to its bare form so the middle line is the
    // ampersand alone rather than an ampersand with the spaces around it.
    return [before, join.trim(), after]
  }

  return [headline]
}

export function HeroBlock({
  blockId,
  config,
}: {
  readonly blockId: string
  readonly config: HeroConfig
}) {
  const lines = stackNames(config.headline)
  const host = readAssetHostConfig()

  return (
    <BlockSection
      blockId={blockId}
      className="text-center"
      bleed={config.artwork === undefined ? undefined : <HeroArtwork artwork={config.artwork} />}
    >
      {config.image !== undefined && (
        /*
         * A plain img rather than next/image. next/image needs either a host
         * allowlist or stored dimensions, and the format has neither: a picture
         * names a source and its stored widths, and there is nowhere to put a
         * height. See docs/blocks.md.
         *
         * The address is resolved and every stored width offered, the same way
         * the envelope does it and for the same reasons: content names an
         * upload as `/a/<key>` and never a hostname, and a photograph that was
         * re-encoded to three widths should not send the largest to a phone.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveAssetSrc(config.image.src, host)}
          {...srcSetOf(config.image, host)}
          alt={config.image.alt}
          fetchPriority="high"
          decoding="async"
          className="mb-[var(--space-lg)] w-full rounded-[var(--radius-lg)] object-cover"
        />
      )}

      {config.eyebrow !== undefined && (
        <p className="type-caption text-[color:var(--color-ink-muted)]">{config.eyebrow}</p>
      )}

      {/*
       * Each line is its own block level element, so the lockup does not depend
       * on where the browser would have chosen to wrap. The spaces between them
       * are kept in the markup rather than being thrown away by the layout, so
       * the heading's text content is still "Alexandra & Christopher" and a
       * screen reader reads one name rather than three fragments.
       *
       * `break-words` stays for the case the split cannot help with: one name
       * long enough to overflow on its own. Overflow is a correctness failure on
       * a phone; a broken line is not.
       */}
      <h1 className="type-display mt-[var(--space-sm)] text-balance break-words">
        {lines.map((line, index) => (
          <Fragment key={index}>
            {index > 0 && ' '}
            <span data-name-line={index} className="block">
              {line}
            </span>
          </Fragment>
        ))}
      </h1>

      {config.subhead !== undefined && (
        <p className="type-body mt-[var(--space-md)] text-[color:var(--color-ink-muted)]">
          {config.subhead}
        </p>
      )}
    </BlockSection>
  )
}

/**
 * The artwork band.
 *
 * It has no aspect ratio of its own, and no crop. The band IS the shape of the
 * file, which is why the placeholder committed with this change is a crop of
 * the card the captain supplied rather than the whole card: a shape decision
 * taken here would be a shape every future piece of artwork had to agree with,
 * and there is nowhere in the format to record what part of a picture matters.
 * The cost is that a whole invitation card named here renders as a whole
 * invitation card, text and all. See docs/blocks.md.
 *
 * The wrapper carries no styles. It exists so the reveal animation has an
 * element to clip and transform without reaching into this block.
 */
function HeroArtwork({ artwork }: { readonly artwork: NonNullable<HeroConfig['artwork']> }) {
  const host = readAssetHostConfig()

  return (
    <div data-hero-artwork="">
      {/*
       * A plain img, for the same reason the photo above is one: next/image
       * wants a host allowlist or stored dimensions and the format has neither.
       *
       * `alt=""` plus `aria-hidden` is the whole accessibility contract of this
       * element. It says nothing the page does not already say in real text.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveAssetSrc(artwork.src, host)}
        {...srcSetOf(artwork, host)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        fetchPriority="low"
        decoding="async"
        className="block w-full"
      />
    </div>
  )
}

/**
 * The `srcset` attribute for a picture, or nothing at all.
 *
 * Spread rather than returned as a string, so a picture with one width emits no
 * attribute instead of an empty one: a srcset offering the browser the file it
 * already has in `src` is bytes in the document that decide nothing.
 *
 * There is deliberately no `sizes`, for the reason the envelope has none: a
 * `sizes` value is a CSS length written into a component, which the block token
 * rule forbids, and the default it would replace is `100vw`, which on the phone
 * these widths exist for is very nearly true.
 */
function srcSetOf(
  picture: {
    readonly widths?: readonly { readonly src: string; readonly width: number }[] | undefined
  },
  host: ReturnType<typeof readAssetHostConfig>
): { srcSet?: string } {
  if (picture.widths === undefined) return {}
  return {
    srcSet: picture.widths
      .map((candidate) => `${resolveAssetSrc(candidate.src, host)} ${candidate.width}w`)
      .join(', '),
  }
}
