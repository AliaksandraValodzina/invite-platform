/**
 * The form, read out of the format.
 *
 * This module is the answer to "how does a buyer edit a block without somebody
 * writing a form for that block". A block already declares everything a form
 * needs: which keys it has, which are required, how long each may be, which
 * ones are a fixed set of choices, and which are pictures. All of that lives in
 * `BLOCK_CONFIG_SCHEMAS`, which is where it has to live anyway because it is
 * what validates a save.
 *
 * So the editor does not read block types. It reads a schema, turns it into a
 * list of fields, and draws a control per field. A sixth block type added to
 * `BLOCK_CONFIG_SCHEMAS` gets an editable form the same afternoon, and nobody
 * touches this file or the components that consume it. That claim is tested in
 * `tests/unit/editor/fields.test.ts` with a block type that does not exist.
 *
 * ## Why JSON Schema in the middle
 *
 * `z.toJSONSchema` is a documented, stable surface on Zod. Walking Zod's own
 * internals would work today and break on the next minor, and this is the one
 * place in the repo that would need to know the difference between a
 * `ZodOptional` and a check on a `ZodString`. Going through JSON Schema also
 * makes the intermediate readable: the whole form is one object a test can
 * print.
 *
 * The important limit, and it is a feature: **JSON Schema describes the shape,
 * it does not decide what is valid.** A `superRefine` such as "exactly one of
 * value or source" does not survive the conversion, so a form built from it can
 * offer a combination the schema will reject. That is correct. The Zod schema is
 * still the only thing that says yes on a save (`src/lib/editor/document.ts`),
 * and a form that lets you type something wrong and then tells you is a normal
 * form. A form that decided validity for itself would be a second answer to
 * "what is a valid hero", and the two would disagree on the day it mattered.
 *
 * ## What a control is chosen by
 *
 * Structure, in every case but two:
 *
 *   `control: 'picture'`  a picture the buyer swaps, whose address and stored
 *                         widths move together. Set on the OBJECT by
 *                         `decorativePicture` and `contentPicture`, because a
 *                         control that owned only `src` would leave a srcset
 *                         pointing at the picture that was just replaced.
 *   `control: 'url'`      an https URL, which wants a different keyboard on a
 *                         phone than a line of prose does.
 *
 * Both are `.meta()` on the schema, so they travel with the format rather than
 * living in a table beside it. Everything else falls out of the JSON Schema:
 * booleans are toggles, enums are choices, arrays of enums are checkbox groups,
 * arrays of objects are rows, and a string is a line or a paragraph depending on
 * how much of it the format is willing to hold.
 *
 * A field this module cannot place becomes `opaque`, and an opaque field is
 * drawn as "this deploy has no control for it" and passed through untouched on
 * save. That is what keeps the promise honest for a block nobody has thought
 * about yet: it gets a form with a hole in it rather than no form at all, and
 * nothing a buyer stored is lost by the hole.
 */

import { z } from 'zod'

/**
 * The ceiling at which a string stops being a line and becomes a paragraph.
 *
 * Read off `maxLength`, which is the format's own statement about how much text
 * belongs in the field. An address (240) and an RSVP introduction (300) get a
 * box with room in it; a headline (120) and a button label (40) get one line.
 */
export const PARAGRAPH_MIN_LENGTH = 200

export type FieldControl =
  | { readonly kind: 'line'; readonly maxLength: number | null }
  | { readonly kind: 'paragraph'; readonly maxLength: number | null }
  | { readonly kind: 'url'; readonly maxLength: number | null }
  | {
      readonly kind: 'number'
      readonly integer: boolean
      readonly minimum: number | null
      readonly maximum: number | null
    }
  | { readonly kind: 'toggle' }
  | { readonly kind: 'choice'; readonly values: readonly string[] }
  | {
      readonly kind: 'choices'
      readonly values: readonly string[]
      readonly minItems: number | null
      readonly maxItems: number | null
    }
  /**
   * A picture. `src` and `widths` are not fields: they are what the control
   * writes when a buyer swaps the file. `fields` holds whatever else the format
   * put on the picture, which today is `alt` on a photograph and nothing on
   * decoration.
   */
  | {
      readonly kind: 'picture'
      /**
       * Which upload kind fills this slot, declared by the format. It decides
       * the widths the capability stores, and therefore what a guest is served.
       */
      readonly uploadKind: 'image' | 'envelope'
      readonly fields: readonly Field[]
    }
  | { readonly kind: 'group'; readonly fields: readonly Field[] }
  /**
   * A list of objects, edited in place. The length is whatever the stored value
   * has: adding and removing entries is composition, and composition belongs to
   * the template.
   */
  | { readonly kind: 'rows'; readonly fields: readonly Field[] }
  | { readonly kind: 'opaque' }

export type Field = {
  readonly key: string
  /** What a buyer reads above the control. */
  readonly label: string
  readonly required: boolean
  readonly control: FieldControl
}

/** The two keys a picture control owns, which are therefore never fields. */
export const PICTURE_KEYS = ['src', 'widths'] as const

type JsonSchemaNode = {
  readonly type?: string
  readonly description?: string
  readonly control?: string
  readonly uploadKind?: string
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>
  readonly required?: readonly string[]
  readonly items?: JsonSchemaNode
  readonly maxLength?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
}

/**
 * The fields of one config schema, in the order the format declares them.
 *
 * Order is not incidental. A JSON Schema's `properties` preserves the order of
 * the Zod shape, which is the order somebody wrote the block in, which is the
 * order the block draws things on the page. The form reads top to bottom the
 * way the section does.
 */
export function readFields(schema: z.ZodType): readonly Field[] {
  return fieldsOf(describe(schema))
}

/**
 * The JSON Schema for one config schema.
 *
 * `io: 'input'` because a buyer is typing what goes IN. `unrepresentable: 'any'`
 * so a future field that JSON Schema cannot express becomes an empty node, and
 * therefore an opaque field, rather than throwing and taking the whole form
 * down with it.
 */
export function describe(schema: z.ZodType): JsonSchemaNode {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchemaNode
}

function fieldsOf(node: JsonSchemaNode, skip: readonly string[] = []): readonly Field[] {
  const properties = node.properties
  if (properties === undefined) return []

  const required = new Set(node.required ?? [])

  return Object.entries(properties)
    .filter(([key]) => !skip.includes(key))
    .map(([key, property]) => ({
      key,
      label: property.description ?? humanise(key),
      required: required.has(key),
      control: controlOf(property),
    }))
}

function controlOf(node: JsonSchemaNode): FieldControl {
  if (node.control === 'picture') {
    return {
      kind: 'picture',
      // Anything but the one slot that is drawn full bleed is a picture in the
      // reading column, which is the kind the capability stores three widths of.
      uploadKind: node.uploadKind === 'envelope' ? 'envelope' : 'image',
      fields: fieldsOf(node, PICTURE_KEYS),
    }
  }

  if (node.enum !== undefined) {
    return { kind: 'choice', values: node.enum.filter(isString) }
  }

  if (node.type === 'boolean') return { kind: 'toggle' }

  if (node.type === 'integer' || node.type === 'number') {
    return {
      kind: 'number',
      integer: node.type === 'integer',
      /*
       * An exclusive bound is turned into an inclusive one for an integer,
       * because that is what a number input's `min` attribute means. It is only
       * a hint either way: the schema is what refuses the value.
       */
      minimum: node.minimum ?? exclusiveAsInclusive(node.exclusiveMinimum, 1),
      maximum: node.maximum ?? exclusiveAsInclusive(node.exclusiveMaximum, -1),
    }
  }

  if (node.type === 'string') {
    const maxLength = node.maxLength ?? null
    if (node.control === 'url') return { kind: 'url', maxLength }
    if (maxLength !== null && maxLength >= PARAGRAPH_MIN_LENGTH) {
      return { kind: 'paragraph', maxLength }
    }
    return { kind: 'line', maxLength }
  }

  if (node.type === 'array') {
    const items = node.items
    if (items === undefined) return { kind: 'opaque' }

    if (items.enum !== undefined) {
      return {
        kind: 'choices',
        values: items.enum.filter(isString),
        minItems: node.minItems ?? null,
        maxItems: node.maxItems ?? null,
      }
    }

    if (items.type === 'object') return { kind: 'rows', fields: fieldsOf(items) }

    return { kind: 'opaque' }
  }

  if (node.type === 'object') return { kind: 'group', fields: fieldsOf(node) }

  return { kind: 'opaque' }
}

function exclusiveAsInclusive(bound: number | undefined, step: number): number | null {
  return bound === undefined ? null : bound + step
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * A label for a field the format never named.
 *
 * `venueName` becomes "Venue name". It is deliberately plain: a key that reads
 * badly as a label is a key that wants a `label` in the schema, where the words
 * a buyer sees belong. This is the fallback that makes a form exist at all for a
 * block written by somebody who has not thought about labels yet.
 */
export function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
