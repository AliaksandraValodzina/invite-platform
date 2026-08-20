/**
 * The template definition format.
 *
 * Three versioned JSON documents, each stored in its own column:
 *
 *   definition   templates.definition      structure and default content
 *   theme        templates.theme           tokens, and only tokens
 *   content      event_content.content     the buyer's overrides, keyed by block id
 *                event_content.theme       the buyer's theme override
 *
 * Start at docs/template-format.md for why it is shaped this way.
 */

export {
  BLOCK_CONFIG_SCHEMAS,
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  COUNTDOWN_UNITS,
  DETAIL_ICONS,
  countdownConfigSchema,
  detailsConfigSchema,
  heroConfigSchema,
  isAuthorable,
  isBlockType,
  mapConfigSchema,
  rsvpFormConfigSchema,
  type BlockRegistryEntry,
  type BlockType,
  type CountdownConfig,
  type DetailsConfig,
  type HeroConfig,
  type MapConfig,
  type RsvpFormConfig,
} from './blocks'

export { UNIVERSAL_ENVELOPE, envelopeConfigSchema, type EnvelopeConfig } from './envelope'

export {
  CONTENT_MIGRATIONS,
  CURRENT_CONTENT_VERSION,
  EMPTY_EVENT_CONTENT,
  eventContentPipeline,
  eventContentSchema,
  type EventContent,
} from './content'

export {
  CURRENT_DEFINITION_VERSION,
  DEFINITION_MIGRATIONS,
  createTemplateDefinitionSchema,
  findRetiredBlocks,
  templateDefinitionPipeline,
  templateDefinitionSchema,
  type BlockConfigSchemas,
  type TemplateBlock,
  type TemplateDefinition,
} from './definition'

export {
  createDocumentPipeline,
  type DocumentIssue,
  type DocumentMigration,
  type DocumentPipeline,
  type JsonObject,
  type LoadFailureReason,
  type LoadOutcome,
} from './document'

export {
  DEFAULT_RESOLVE_DEPENDENCIES,
  applyOverride,
  resolveEventPage,
  type OmittedBlock,
  type OrphanedContent,
  type ResolveOutcome,
  type ResolvedPage,
  type StoredEventDocuments,
} from './resolve'

export {
  AAA_NORMAL_TEXT,
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  contrastRatioTo2dp,
  isLargeText,
  parseHex,
  relativeLuminance,
  requiredRatio,
  type Rgb,
} from './contrast'

export {
  COLOUR_ROLES,
  CURRENT_THEME_VERSION,
  EMPTY_THEME_OVERRIDE,
  FONT_ROLES,
  RADIUS_STEPS,
  SPACE_STEPS,
  THEME_MIGRATIONS,
  TYPE_ROLES,
  mergeThemeTokens,
  primaryFamily,
  themeColoursSchema,
  themeDocumentSchema,
  themeOverrideDocumentSchema,
  themeOverridePipeline,
  themePipeline,
  themeFaces,
  themeToCssVariables,
  themeTokensSchema,
  type ColourRole,
  type Face,
  type FontRole,
  type RadiusStep,
  type SpaceStep,
  type ThemeDocument,
  type ThemeOverrideDocument,
  type ThemeTokens,
  type TypeRole,
} from './theme'
