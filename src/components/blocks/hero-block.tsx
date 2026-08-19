/**
 * The hero: the eyebrow, the names, the line under them, and optionally a photo.
 *
 * The headline is the page's `h1`. It is also the one piece of copy on the page
 * that is guaranteed to be as long as the buyer's names, and the measurements in
 * data/ip-design-directions/report.md say that "Alexandra & Christopher" set at
 * display size overflows 320px in all three directions. So it wraps, and it
 * breaks inside a word if it has to. Overflow is a correctness failure on a
 * phone; a broken line is not.
 *
 * The report's other recommendation, that display size should be fluid so a long
 * name scales itself down, is a change to the token schema rather than to this
 * file, and is deliberately not made here. See docs/blocks.md.
 */

import type { HeroConfig } from '@/lib/template'

import { BlockSection } from './block-section'

export function HeroBlock({
  blockId,
  config,
}: {
  readonly blockId: string
  readonly config: HeroConfig
}) {
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

      <h1 className="type-display mt-[var(--space-sm)] text-balance break-words">
        {config.headline}
      </h1>

      {config.subhead !== undefined && (
        <p className="type-body mt-[var(--space-md)] text-[color:var(--color-ink-muted)]">
          {config.subhead}
        </p>
      )}
    </BlockSection>
  )
}
