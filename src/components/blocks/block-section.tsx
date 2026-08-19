/**
 * The outer element every block renders into, so page rhythm is decided once.
 *
 * The section padding is `space.md` across and `space.xl` down, which means the
 * distance between two blocks is a theme decision: a theme with a generous `xl`
 * produces an airy page and a tight one produces a dense page, from the same
 * block set and the same words.
 */

import type { ReactNode } from 'react'

export function BlockSection({
  blockId,
  labelledBy,
  className,
  children,
}: {
  readonly blockId: string
  /** Id of the heading that names this section, when it has one. */
  readonly labelledBy?: string | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <section
      data-block-id={blockId}
      aria-labelledby={labelledBy}
      className={`px-[var(--space-md)] py-[var(--space-xl)] ${className ?? ''}`}
    >
      {children}
    </section>
  )
}
