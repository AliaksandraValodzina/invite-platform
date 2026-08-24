/**
 * Composition: which of a template's sections an invitation has, in what order.
 *
 * One function, and it is small on purpose. What matters is the three rules it
 * encodes, because every one of them is a decision somebody has to be able to
 * find later.
 *
 * ## Absent means the template, not "nothing"
 *
 * `content.sections` is an override like everything else in that document. An
 * event that has never had a section moved carries no `sections` key at all,
 * and renders the template's block list in the template's order. That is what
 * lets a template gain a section and have it reach every event whose buyer
 * never touched their composition, which is the same promise the words make.
 *
 * ## A section list names ids, and an id names a template block
 *
 * There is no config in here and no type. The id selects the block, the block's
 * `type` selects the schema, and the buyer's words are keyed by the id. Keeping
 * those apart is what makes a rename survivable, and it is also why this is
 * cheap: composition is a permutation of a list that already exists.
 *
 * A consequence worth stating plainly: this shape cannot name a section the
 * template does not contain. Adding one means restoring one the buyer took out.
 * A catalogue of designs to add from is the other half of this stage and is
 * gated on an open decision about authoring capacity, and reaching it is a
 * version bump on the content document, which is what the format is built for.
 *
 * ## An id nobody recognises is skipped, never fatal
 *
 * A template can genuinely lose a block: a type is retired, an id is rewritten
 * by a definition migration. An invitation whose composition still names it
 * must keep serving, so the id is dropped from the page and reported. A wedding
 * page that went dark because of a change we made to a template would be a
 * failure the buyer cannot even see the cause of, let alone repair.
 */

export type ComposedBlock = { readonly id: string }

export type Composition<Block extends ComposedBlock> = {
  /** The blocks to draw, in the order the page draws them. */
  readonly blocks: readonly Block[]
  /**
   * Template blocks the composition leaves out.
   *
   * They are not drawn and their stored words are not touched, which is the
   * whole answer to "I removed that by accident". See docs/composition.md.
   */
  readonly removed: readonly string[]
  /** Ids the composition names that this template has no block for. */
  readonly unknown: readonly string[]
}

/**
 * The template's blocks arranged the way the buyer composed them.
 *
 * `sections` undefined is the template's own list, untouched and in order, and
 * that is the only path an event that predates composition ever takes.
 */
export function composeSections<Block extends ComposedBlock>(
  blocks: readonly Block[],
  sections: readonly string[] | undefined
): Composition<Block> {
  if (sections === undefined) return { blocks, removed: [], unknown: [] }

  const byId = new Map(blocks.map((block) => [block.id, block]))
  const named = new Set(sections)

  const composed: Block[] = []
  const unknown: string[] = []

  for (const id of sections) {
    const block = byId.get(id)
    if (block === undefined) {
      unknown.push(id)
      continue
    }
    composed.push(block)
  }

  return {
    blocks: composed,
    removed: blocks.filter((block) => !named.has(block.id)).map((block) => block.id),
    unknown,
  }
}

/** The section list a template's own block order would be written as. */
export function sectionIdsOf(blocks: readonly ComposedBlock[]): string[] {
  return blocks.map((block) => block.id)
}

export function sameSections(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}
