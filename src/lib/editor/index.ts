/**
 * The guided form, driven by the template format.
 *
 * Three modules and one idea: a block already declares everything a form needs,
 * so the editor reads the schema rather than being written per block type.
 *
 *   fields       the format as a list of controls
 *   values       a submitted form as a config, and then as an override
 *   document     what is editable, what a save writes, and the gate in front of it
 *   composition  which sections an invitation has, in what order
 *   palette      the buyer's colours, as a theme override
 *
 * Start at docs/editing.md. Nothing here reaches a database: the reads and
 * writes are in src/lib/supabase/editing.ts, as the buyer.
 */

export {
  PARAGRAPH_MIN_LENGTH,
  PICTURE_KEYS,
  describe,
  humanise,
  readFields,
  type Field,
  type FieldControl,
} from './fields'

export {
  deepEqual,
  fieldName,
  isRecord,
  overrideFor,
  pictureFields,
  readValue,
  type JsonRecord,
  type PictureField,
  type PictureValue,
  type ReadValueInput,
} from './values'

export {
  LOAD_BEARING_BLOCK_FIELDS,
  blockDetailChanges,
  isLoadBearingBlock,
  loadBearingFieldsFor,
  scheduleDetailChanges,
} from './load-bearing'

export {
  ENVELOPE_SECTION,
  buildContentDocument,
  checkContent,
  editableSections,
  sectionPrefix,
  withSections,
  type ContentCheck,
  type EditableSection,
} from './document'

export {
  COMPOSITION_COMMANDS,
  COMPOSITION_FIELD,
  applyCompositionCommand,
  compositionValue,
  compositionView,
  parseCompositionCommand,
  type CompositionChange,
  type CompositionCommand,
  type CompositionCommandKind,
  type CompositionRow,
  type CompositionView,
} from './composition'

export {
  ACCENT_INK_CHOICES,
  ACCENT_INK_FIELD,
  BUYER_COLOUR_ROLES,
  COLOUR_LABELS,
  NO_PALETTE_OVERRIDE,
  PALETTE_FIELD,
  PALETTE_RESET,
  accentInkChoiceOf,
  colourFieldName,
  contrastFindings,
  contrastWarnings,
  paletteOverride,
  readPalette,
  type AccentInkChoice,
  type ContrastFinding,
  type PaletteColours,
  type PaletteRead,
} from './palette'
