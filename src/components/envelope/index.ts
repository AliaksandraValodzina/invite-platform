/**
 * The envelope, which is one component and deliberately not a block.
 *
 * A block is a section of the invitation, drawn in the reading column in the
 * order the definition lists it. This is drawn over the whole page and belongs
 * to none of it, so it lives beside `src/components/blocks/` rather than in it,
 * and `BLOCK_CONFIG_SCHEMAS` still holds five types. It is held to the same
 * token rule the block set is held to, by the same guard, which reads this
 * directory too. See docs/envelope.md.
 */

export { DEFAULT_OPEN_LABEL, EnvelopeCover, envelopeHeadline, sealInitials } from './envelope-cover'
