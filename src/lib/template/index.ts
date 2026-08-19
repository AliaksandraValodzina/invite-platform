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

export {
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
  COLOUR_ROLES,
  CURRENT_THEME_VERSION,
  EMPTY_THEME_OVERRIDE,
  RADIUS_STEPS,
  SPACE_STEPS,
  TYPE_ROLES,
  mergeThemeTokens,
  themeDocumentSchema,
  themeOverrideDocumentSchema,
  themeOverridePipeline,
  themePipeline,
  themeToCssVariables,
  themeTokensSchema,
  type ColourRole,
  type ThemeDocument,
  type ThemeOverrideDocument,
  type ThemeTokens,
} from './theme'
