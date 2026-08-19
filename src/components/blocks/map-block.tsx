/**
 * Where the event is: venue, address, a note, and a way out to a maps app.
 *
 * There is no embedded map here, and that is the format's decision rather than
 * this file's. A tile embed means a provider, an API key and third party
 * JavaScript on a page that a guest opens from a chat link on bad wifi, and the
 * config carries no provider because a key is deployment config. `coordinates`
 * is stored and deliberately not rendered for the same reason; see
 * docs/blocks.md for what it is waiting on.
 *
 * The address is rendered with newlines preserved, because addresses are not
 * uniform across countries and the buyer typed the line breaks they wanted.
 */

import type { MapConfig } from '@/lib/template'

import { BlockSection } from './block-section'

/**
 * The format has no label for this link, so the block set supplies one. If a
 * buyer ever needs to change it, that is a field on the map config and a
 * version migration, not a literal edited in here.
 */
const DIRECTIONS_LABEL = 'Get directions'

export function MapBlock({
  blockId,
  config,
}: {
  readonly blockId: string
  readonly config: MapConfig
}) {
  const headingId = `${blockId}-heading`

  return (
    <BlockSection
      blockId={blockId}
      labelledBy={config.heading === undefined ? undefined : headingId}
    >
      {config.heading !== undefined && (
        <h2 id={headingId} className="type-title">
          {config.heading}
        </h2>
      )}

      <div className="mt-[var(--space-lg)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-[var(--space-md)]">
        <p className="type-title break-words">{config.venueName}</p>

        <address className="type-body mt-[var(--space-xs)] break-words whitespace-pre-line text-[color:var(--color-ink-muted)] not-italic">
          {config.address}
        </address>

        {config.note !== undefined && (
          <p className="type-caption mt-[var(--space-sm)] text-[color:var(--color-ink-muted)]">
            {config.note}
          </p>
        )}

        {config.directionsUrl !== undefined && (
          <a
            href={config.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="type-body mt-[var(--space-md)] inline-block text-[color:var(--color-accent)] underline"
          >
            {DIRECTIONS_LABEL}
          </a>
        )}
      </div>
    </BlockSection>
  )
}
