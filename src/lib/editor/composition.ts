/**
 * Composition, as the editor works it: which sections an invitation has, in
 * what order.
 *
 * Pure, and testable without a database or a browser. It turns a template
 * definition and a buyer's stored content into the rows the panel draws, and it
 * turns one pressed button into the next section list.
 *
 * ## One press, one complete list
 *
 * There is no drag and drop and there is no ordering field to type into. Each
 * control is a submit button carrying `up:<id>`, `down:<id>`, `remove:<id>` or
 * `add:<id>`, so the whole panel works with no JavaScript at all, and each
 * press produces a whole valid section list rather than a partial edit somebody
 * has to commit later. That matters beyond ergonomics: every save is a new
 * published revision (docs/editing.md), so a half applied reorder would be a
 * half built page in front of guests. One press is one transaction.
 *
 * ## Removing a section keeps its words
 *
 * Removal takes an id out of the list and touches `content.blocks` not at all,
 * so putting the section back is the same thing as never having removed it. The
 * stored notebook is the only copy a buyer has of their own words, and somebody
 * who removed a section by accident should not be paying for it in typing. See
 * docs/composition.md.
 *
 * ## What can be added
 *
 * Sections this template has that the invitation currently leaves out, and
 * nothing else. There is no catalogue of designs to add from: that is the other
 * half of stage 7 and its size is set by an authoring pipeline that has not been
 * decided on. A picker offering sections nothing has been authored for would be
 * a promise the product cannot keep.
 */

import {
  BLOCK_REGISTRY,
  composeSections,
  sameSections,
  sectionIdsOf,
  type EventContent,
  type TemplateDefinition,
} from '@/lib/template'

/** The form field every composition control submits under. */
export const COMPOSITION_FIELD = 'section'

export const COMPOSITION_COMMANDS = ['up', 'down', 'remove', 'add'] as const

export type CompositionCommandKind = (typeof COMPOSITION_COMMANDS)[number]

export type CompositionCommand = {
  readonly kind: CompositionCommandKind
  readonly id: string
}

/** The value one composition button submits, such as `up:venue-map`. */
export function compositionValue(kind: CompositionCommandKind, id: string): string {
  return `${kind}:${id}`
}

/**
 * The pressed button as a command, or null.
 *
 * Null covers a form that carried nothing, a kind this build does not have and
 * an id that is not one. A server action is a POST endpoint reachable directly,
 * so this is a parser and not a formality.
 */
export function parseCompositionCommand(value: unknown): CompositionCommand | null {
  if (typeof value !== 'string') return null

  const separator = value.indexOf(':')
  if (separator <= 0) return null

  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)

  if (!isCommandKind(kind)) return null
  if (id === '') return null

  return { kind, id }
}

function isCommandKind(value: string): value is CompositionCommandKind {
  return (COMPOSITION_COMMANDS as readonly string[]).includes(value)
}

export type CompositionRow = {
  readonly id: string
  readonly type: string
  /** What the section is called on screen, from the block registry. */
  readonly label: string
  /** True when the buyer has stored words under this block id. */
  readonly hasWords: boolean
}

export type CompositionView = {
  /** The sections on the invitation, in the order a guest reads them. */
  readonly present: readonly CompositionRow[]
  /**
   * Sections this template has that the invitation leaves out.
   *
   * This is the whole of what "add a section" can offer, and it is why the
   * empty case is worth wording rather than hiding: an invitation nobody has
   * taken anything out of has nothing to put back.
   */
  readonly removed: readonly CompositionRow[]
  /**
   * Ids the stored composition names that this template has no section for.
   *
   * Reported rather than silently swallowed. The next composition change writes
   * a list built from this template, so these ids go; the words stored under
   * them do not, because no save touches `content.blocks` for a section it is
   * not editing.
   */
  readonly unknown: readonly string[]
  /** True when nothing has been composed and the template's own order is in force. */
  readonly isTemplateOrder: boolean
}

export function compositionView(
  definition: TemplateDefinition,
  content: EventContent
): CompositionView {
  const composed = composeSections(definition.blocks, content.sections)
  const present = new Set(composed.blocks.map((block) => block.id))

  const row = (block: { id: string; type: string }): CompositionRow => ({
    id: block.id,
    type: block.type,
    label: BLOCK_REGISTRY[block.type as keyof typeof BLOCK_REGISTRY]?.label ?? block.type,
    hasWords: Object.hasOwn(content.blocks, block.id),
  })

  return {
    present: composed.blocks.map(row),
    removed: definition.blocks.filter((block) => !present.has(block.id)).map(row),
    unknown: composed.unknown,
    isTemplateOrder: content.sections === undefined,
  }
}

export type CompositionChange =
  | {
      readonly ok: true
      /**
       * The list to store, or undefined to store none.
       *
       * Undefined when the result is the template's own order. Composition is
       * an override like the words are, so an invitation that ends up back at
       * what the template says stops carrying a list, and a section the
       * template gains later reaches it.
       */
      readonly sections: readonly string[] | undefined
    }
  | { readonly ok: false; readonly message: string }

/**
 * One pressed button, applied.
 *
 * Refusals are sentences a buyer can act on rather than field paths, because
 * every one of them is about the button they just pressed rather than about
 * something they typed.
 */
export function applyCompositionCommand(
  definition: TemplateDefinition,
  content: EventContent,
  command: CompositionCommand
): CompositionChange {
  const templateOrder = sectionIdsOf(definition.blocks)

  /*
   * Built from the template's blocks rather than from the stored list, so an id
   * the template no longer has cannot be moved, removed or counted. It is
   * reported to the buyer by `compositionView` instead.
   */
  const current = composeSections(definition.blocks, content.sections).blocks.map(
    (block) => block.id
  )

  const settle = (next: readonly string[]): CompositionChange => ({
    ok: true,
    sections: sameSections(next, templateOrder) ? undefined : next,
  })

  if (command.kind === 'add') {
    if (current.includes(command.id)) {
      return { ok: false, message: 'That section is already on the invitation.' }
    }
    if (!templateOrder.includes(command.id)) {
      return { ok: false, message: 'This template has no section with that name.' }
    }
    /*
     * The end, so the buyer can see where it went. Guessing at where it used to
     * be would mean remembering a position we deliberately do not store, and
     * quietly putting a section back into the middle of a page is a worse
     * surprise than putting it somewhere obvious.
     */
    return settle([...current, command.id])
  }

  const index = current.indexOf(command.id)
  if (index === -1) {
    return { ok: false, message: 'That section is not on the invitation.' }
  }

  if (command.kind === 'remove') {
    if (current.length === 1) {
      return {
        ok: false,
        message:
          'An invitation needs at least one section. Add another before taking this one out.',
      }
    }
    return settle(current.filter((id) => id !== command.id))
  }

  const target = command.kind === 'up' ? index - 1 : index + 1
  if (target < 0) return { ok: false, message: 'That section is already first.' }
  if (target >= current.length) return { ok: false, message: 'That section is already last.' }

  const next = [...current]
  next[index] = current[target] as string
  next[target] = command.id

  return settle(next)
}
