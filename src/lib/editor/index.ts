/**
 * The guided form, driven by the template format.
 *
 * Three modules and one idea: a block already declares everything a form needs,
 * so the editor reads the schema rather than being written per block type.
 *
 *   fields    the format as a list of controls
 *   values    a submitted form as a config, and then as an override
 *   document  what is editable, what a save writes, and the gate in front of it
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
  type ContentCheck,
  type EditableSection,
} from './document'
