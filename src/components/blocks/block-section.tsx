/**
 * The outer element every block renders into, so page rhythm is decided once.
 *
 * The section padding is `space.md` across and `space.xl` down, which means the
 * distance between two blocks is a theme decision: a theme with a generous `xl`
 * produces an airy page and a tight one produces a dense page, from the same
 * block set and the same words.
 *
 * The padding sits on an inner element rather than on the `section` so that a
 * block can put something outside it. `bleed` is that slot: it spans the full
 * width of the page canvas and it sits above the section's own top padding, so
 * a hero artwork band starts at the very top edge of the page rather than one
 * `space.xl` down from it. Nothing else uses it, and a block that passes
 * nothing renders exactly the markup it did before, with one wrapper around
 * its children.
 */

import type { ReactNode } from 'react'

export function BlockSection({
  blockId,
  labelledBy,
  className,
  bleed,
  children,
}: {
  readonly blockId: string
  /** Id of the heading that names this section, when it has one. */
  readonly labelledBy?: string | undefined
  readonly className?: string | undefined
  /** Rendered full width, above the padded content. Decoration only. */
  readonly bleed?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section
      data-block-id={blockId}
      aria-labelledby={labelledBy}
      className={className ?? undefined}
    >
      {bleed}
      <div className="px-[var(--space-md)] py-[var(--space-xl)]">{children}</div>
    </section>
  )
}
