/**
 * The hero: the eyebrow, the names, the line under them, and optionally a photo.
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

  return (
    <BlockSection blockId={blockId} className="text-center">
      {config.image !== undefined && (
        /*
         * A plain img rather than next/image. next/image needs either a host
         * allowlist or stored dimensions, and the format has neither yet: an
         * image src is any https URL, and there is nowhere to put a width and a
         * height. Both arrive with buyer uploads. See docs/blocks.md.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={config.image.src}
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
