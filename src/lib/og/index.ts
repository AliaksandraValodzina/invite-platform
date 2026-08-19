/**
 * The Open Graph share card.
 *
 * The card is 1200x630 and is generated per event from theme tokens plus the
 * event's own fields. It is the first impression of the product: it is what
 * appears when a buyer pastes their link into WhatsApp, iMessage or an
 * Instagram DM, and in all three it is first seen as a thumbnail about 120px
 * wide. Read contract.ts first; it is where that constraint turns into numbers.
 *
 * `themes.ts` is deliberately not re-exported here. It statically imports the
 * seed theme files, and pulling a JSON import into every consumer of this
 * module is a cost the layout, the contract and the metadata do not need to
 * pay. The route imports it directly, and it goes away entirely once the event
 * read path supplies real tokens.
 */

export {
  MIN_LEGIBLE_THUMBNAIL_PX,
  MIN_TITLE_FONT_SIZE,
  OG_CARD_CONTRAST_PAIRS,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  OG_THUMBNAIL_SCALE,
  OG_THUMBNAIL_WIDTH,
  checkOgCardLegibility,
  contrastRatio,
  type OgContrastPair,
  type OgLegibilityFailure,
  type OgSlotName,
} from './contract'

export { renderOgCard } from './card'

export { formatEventWhen, type EventWhen } from './format'

export {
  MIN_TITLE_ZONE,
  TITLE_SIZES,
  findSlot,
  planOgCard,
  type OgBox,
  type OgCardEvent,
  type OgCardPlan,
  type OgRuleSlot,
  type OgSlot,
  type OgTextSlot,
} from './plan'

export {
  OG_THEME_KEYS,
  buildEventShareMetadata,
  buildOgCardUrl,
  ogCardFooter,
  ogCardParamsSchema,
  parseOgCardParams,
  type OgCardParams,
  type OgParamIssue,
  type OgParamsOutcome,
  type OgThemeKey,
  type ShareImage,
  type ShareMetadata,
  type ShareMetadataInput,
} from './share'

export { estimateTextWidth, truncateToLines, wrapEstimate } from './text'
