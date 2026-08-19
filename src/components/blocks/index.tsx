/**
 * The block set: five components, one per type in `BLOCK_CONFIG_SCHEMAS`.
 *
 * `renderBlock` switches on `type`, never on `id`. That is the same split the
 * format makes: `type` selects the component, `id` is what a buyer's content is
 * keyed by. The switch is exhaustive against the union the format derives from
 * the schema map, so adding a sixth block type fails the typecheck here rather
 * than rendering nothing at runtime.
 *
 * Everything a block needs beyond its own config arrives in `BlockContext`.
 * There is no data fetching in a block and no reading of the clock in a block,
 * so the whole set can be rendered from a fixture in a unit test.
 */

import { Fragment, type ReactElement } from 'react'

import type { ResolvedSchedule } from '@/lib/event/time'
import type { TemplateBlock } from '@/lib/template'

import { CountdownBlock } from './countdown-block'
import { DetailsBlock } from './details-block'
import { HeroBlock } from './hero-block'
import { MapBlock } from './map-block'
import { RsvpFormBlock, type RsvpPhase, type RsvpSubmit } from './rsvp-form-block'

export { BlockSection } from './block-section'
export { CountdownBlock } from './countdown-block'
export { DetailsBlock, resolveDetailValue } from './details-block'
export { HeroBlock } from './hero-block'
export { MapBlock } from './map-block'
export {
  RsvpFormBlock,
  type RsvpPhase,
  type RsvpSubmit,
  type RsvpSubmitResult,
} from './rsvp-form-block'

export type BlockContext = {
  /** The event start, resolved once from the local pair rather than per block. */
  readonly schedule: ResolvedSchedule
  /** The server's clock at render time, so the countdown hydrates without a mismatch. */
  readonly nowMs: number
  readonly rsvp: {
    readonly phase: RsvpPhase
    readonly submit: RsvpSubmit
  }
}

export function renderBlock(block: TemplateBlock, context: BlockContext): ReactElement | null {
  switch (block.type) {
    case 'hero':
      return <HeroBlock blockId={block.id} config={block.config} />
    case 'details':
      return <DetailsBlock blockId={block.id} config={block.config} schedule={context.schedule} />
    case 'countdown':
      return (
        <CountdownBlock
          blockId={block.id}
          config={block.config}
          targetMs={context.schedule.startsAt}
          nowMs={context.nowMs}
        />
      )
    case 'map':
      return <MapBlock blockId={block.id} config={block.config} />
    case 'rsvp-form':
      return (
        <RsvpFormBlock
          blockId={block.id}
          config={block.config}
          phase={context.rsvp.phase}
          submit={context.rsvp.submit}
        />
      )
    default: {
      // A block type with no component is a typecheck failure, not a blank page.
      const unhandled: never = block
      return unhandled
    }
  }
}

export function BlockList({
  blocks,
  context,
}: {
  readonly blocks: readonly TemplateBlock[]
  readonly context: BlockContext
}) {
  return (
    <>
      {blocks.map((block) => (
        <Fragment key={block.id}>{renderBlock(block, context)}</Fragment>
      ))}
    </>
  )
}
