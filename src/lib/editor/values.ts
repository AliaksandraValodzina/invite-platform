/**
 * A submitted form in, a block config out, and then only what changed.
 *
 * Two functions, and the second one is the one that matters.
 *
 * `readValue` walks the field tree from `./fields.ts` and reads one value per
 * field out of the `FormData`. It is driven by the schema, not by the form: it
 * asks for the names it expects and never iterates over what arrived, so a
 * field nobody declared cannot get in, and a field the format has but this
 * deploy has no control for cannot get lost.
 *
 * `overrideFor` turns that config into an OVERRIDE by comparing it with the
 * template's default, key by key at the top level, and keeping only the keys
 * that differ. That is the whole reason content is stored as overrides
 * (docs/template-format.md): a block a buyer never touched has no entry at all,
 * so fixing a typo in a template's default copy reaches every event that did
 * not override it. An editor that saved the whole merged config would quietly
 * end that property on the first save, and nobody would notice until the typo
 * fix did not arrive.
 *
 * Two rules from the format are obeyed here rather than restated:
 *
 * **Top level key replace.** A nested object such as `hero.image` or
 * `rsvp-form.guestCount` is written whole or not at all, because that is how
 * `applyOverride` merges it. The form edits the nested keys; the diff emits the
 * object.
 *
 * **`null` clears.** A buyer who empties the eyebrow line has to be able to say
 * so, and JSON has no way to spell "absent" inside an object being merged. A
 * key that the template has and the buyer emptied comes back as `null`.
 *
 * ## What is never read from the form
 *
 * A picture's address. `src` and `widths` are written from an upload the buyer
 * just made, resolved server side from `public.uploads` as that buyer, so the
 * document names an object we know is theirs rather than an address the browser
 * asked us to write down. The form carries an upload id and a "remove" box, and
 * nothing else about a picture. See `./document.ts`.
 */

import type { Field } from './fields'

export type JsonRecord = Record<string, unknown>

/** Exactly the two keys a picture control writes, which is `PictureContent`. */
export type PictureValue = {
  readonly src: string
  readonly widths?: readonly { readonly src: string; readonly width: number }[]
}

export type ReadValueInput = {
  readonly formData: FormData
  /** Prefix every input name under this value carries, such as `block:hero`. */
  readonly prefix: string
  /**
   * The value as it stands: the template default with the buyer's stored
   * override merged over it.
   *
   * It is here for three jobs, and each one is a way of not losing something.
   * A list's length comes from it, because adding and removing entries is
   * composition. A picture that was not swapped keeps its address from it. And
   * a field this deploy has no control for is copied out of it untouched, so a
   * form with a hole in it cannot silently clear the hole.
   */
  readonly current: JsonRecord
  /**
   * What each picture control resolved to, keyed by field name: a picture to
   * write, or null for one the buyer removed. A field name that is absent from
   * this map means the picture was not touched.
   */
  readonly pictures: ReadonlyMap<string, PictureValue | null>
}

/** The input name a field carries in the form. */
export function fieldName(prefix: string, path: readonly (string | number)[]): string {
  return [prefix, ...path].join('.')
}

/** One picture slot in a form: the name its two controls hang off, and its kind. */
export type PictureField = {
  readonly name: string
  readonly uploadKind: 'image' | 'envelope'
}

/**
 * Every picture in a section, found by walking the schema rather than the form.
 *
 * That direction matters. Reading `.upload` keys off the submitted form would
 * mean a browser could name any number of them and make the server look each one
 * up, and it would mean the set of pictures was decided by whatever arrived. The
 * schema knows how many pictures a section has; the form only gets to say what
 * happened to them.
 */
export function pictureFields(
  fields: readonly Field[],
  prefix: string,
  current: unknown,
  path: readonly (string | number)[] = []
): readonly PictureField[] {
  const record = isRecord(current) ? current : {}
  const found: PictureField[] = []

  for (const field of fields) {
    const at = [...path, field.key]
    const value = record[field.key]
    const control = field.control

    if (control.kind === 'picture') {
      found.push({ name: fieldName(prefix, at), uploadKind: control.uploadKind })
      continue
    }

    if (control.kind === 'group') {
      found.push(...pictureFields(control.fields, prefix, value, at))
      continue
    }

    if (control.kind === 'rows' && Array.isArray(value)) {
      value.forEach((row, index) => {
        found.push(...pictureFields(control.fields, prefix, row, [...at, index]))
      })
    }
  }

  return found
}

export function readValue(fields: readonly Field[], input: ReadValueInput): JsonRecord {
  return readInto(fields, input, [], input.current)
}

function readInto(
  fields: readonly Field[],
  input: ReadValueInput,
  path: readonly (string | number)[],
  current: unknown
): JsonRecord {
  const currentRecord = isRecord(current) ? current : {}
  const value: JsonRecord = {}

  for (const field of fields) {
    const at = [...path, field.key]
    const read = readField(field, input, at, currentRecord[field.key])
    if (read !== undefined) value[field.key] = read
  }

  return value
}

function readField(
  field: Field,
  input: ReadValueInput,
  path: readonly (string | number)[],
  current: unknown
): unknown {
  const name = fieldName(input.prefix, path)
  const control = field.control

  switch (control.kind) {
    case 'opaque':
      // Nothing this deploy can draw, so nothing it may change.
      return current

    case 'line':
    case 'paragraph':
    case 'url':
    case 'choice': {
      const raw = stringOf(input.formData.get(name))
      return raw === '' ? undefined : raw
    }

    case 'number': {
      const raw = stringOf(input.formData.get(name)).trim()
      if (raw === '') return undefined
      const parsed = Number(raw)
      /*
       * A number that will not parse is passed through as the text the buyer
       * typed, so the schema refuses it with a message naming the field rather
       * than this reader turning it into NaN or silently dropping it.
       */
      return Number.isFinite(parsed) ? parsed : raw
    }

    case 'toggle':
      // An unchecked box sends nothing at all, which is what false looks like.
      return input.formData.get(name) !== null

    case 'choices': {
      const chosen = input.formData.getAll(name).map(stringOf).filter(Boolean)
      return chosen.length === 0 ? undefined : chosen
    }

    case 'picture': {
      const resolved = input.pictures.get(name)
      // Explicitly removed. Absent from the map means it was not touched.
      if (resolved === null) return undefined

      const picture = resolved ?? pictureOf(current)
      if (picture === undefined) return undefined

      return { ...picture, ...readInto(control.fields, input, path, current) }
    }

    case 'group': {
      const group = readInto(control.fields, input, path, current)

      /*
       * An optional group with nothing in it is absent rather than empty. That
       * is what lets a buyer clear the coordinates off a map without inventing
       * a "remove" control for every optional object in the format: emptying
       * every box in it is how you say you do not want it.
       *
       * A required group is always written, because its absence is not
       * something the buyer is allowed to mean.
       */
      if (!field.required && Object.keys(group).length === 0) return undefined
      return group
    }

    case 'rows': {
      const rows = Array.isArray(current) ? current : []
      return rows.map((row, index) => readInto(control.fields, input, [...path, index], row))
    }
  }
}

/**
 * The override for one block: the keys of `next` that differ from the template
 * default, and `null` for the ones the buyer emptied.
 *
 * Comparison is on whole top level keys, because that is the granularity the
 * merge works at. A hero whose image alt changed writes the whole `image`
 * object, which is the same object the format would have merged anyway.
 */
export function overrideFor(base: JsonRecord, next: JsonRecord): JsonRecord {
  const override: JsonRecord = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(next)])

  for (const key of keys) {
    const before = base[key]
    const after = next[key]

    if (deepEqual(before, after)) continue

    if (after === undefined) {
      /*
       * The buyer emptied a field the template fills in. `null` is the only way
       * to say that through a merge that is a key replace, and clearing a
       * required field is deliberately not special cased: it produces a missing
       * field error from the block schema, which is the right answer.
       */
      override[key] = null
      continue
    }

    override[key] = after
  }

  return override
}

/** Structural equality over the values a template document can hold. */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return left.length === right.length && left.every((item, at) => deepEqual(item, right[at]))
  }

  const leftKeys = Object.keys(left as JsonRecord)
  const rightKeys = Object.keys(right as JsonRecord)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every(
    (key) =>
      Object.hasOwn(right as JsonRecord, key) &&
      deepEqual((left as JsonRecord)[key], (right as JsonRecord)[key])
  )
}

function pictureOf(current: unknown): PictureValue | undefined {
  if (!isRecord(current) || typeof current.src !== 'string') return undefined

  const widths = current.widths
  if (!Array.isArray(widths)) return { src: current.src }
  return { src: current.src, widths: widths as NonNullable<PictureValue['widths']> }
}

function stringOf(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
