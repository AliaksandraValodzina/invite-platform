import { fieldName, isRecord, type Field, type FieldControl } from '@/lib/editor'
import { resolveAssetSrc } from '@/lib/uploads/host'

import { PictureField } from './picture-field'

/**
 * One control per field, chosen by the field's kind and nothing else.
 *
 * There is no branch here on block type, block id, or any field name. Every
 * decision this file makes was made by the format and read out of it by
 * `src/lib/editor/fields.ts`, which is what "the editor is driven by the format"
 * has to mean if it is to mean anything: a sixth block type gets a form from
 * this component with nobody editing it.
 *
 * ## Where `required` is and is not enforced in the browser
 *
 * A required field at the top level of a section gets the attribute, because
 * catching an empty headline before a round trip is a kindness.
 *
 * A required field INSIDE an optional thing does not, and that is the important
 * half. `coordinates.lat` is required if there are coordinates at all, and
 * `image.alt` is required if there is a photo at all. Marking either of them
 * required in the browser would make the optional thing impossible to clear:
 * emptying every box is exactly how a buyer says they no longer want the
 * coordinates, and the browser would refuse to submit the form that said so.
 * The schema still refuses a half filled one on save, with the field named.
 */

export type SectionFieldsProps = {
  readonly fields: readonly Field[]
  /** The value as it stands, which is what every control starts from. */
  readonly value: unknown
  readonly prefix: string
  readonly eventId: string
  readonly path?: readonly (string | number)[]
  /** False inside anything optional. See the note above. */
  readonly enforceRequired?: boolean
}

export function SectionFields({
  fields,
  value,
  prefix,
  eventId,
  path = [],
  enforceRequired = true,
}: SectionFieldsProps) {
  const record = isRecord(value) ? value : {}

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {fields.map((field) => (
        <FieldControlView
          key={field.key}
          field={field}
          value={record[field.key]}
          prefix={prefix}
          eventId={eventId}
          path={[...path, field.key]}
          enforceRequired={enforceRequired}
        />
      ))}
    </div>
  )
}

function FieldControlView({
  field,
  value,
  prefix,
  eventId,
  path,
  enforceRequired,
}: {
  readonly field: Field
  readonly value: unknown
  readonly prefix: string
  readonly eventId: string
  readonly path: readonly (string | number)[]
  readonly enforceRequired: boolean
}) {
  const name = fieldName(prefix, path)
  const control = field.control
  const required = enforceRequired && field.required

  switch (control.kind) {
    case 'line':
      return (
        <Labelled name={name} label={field.label} required={field.required}>
          <input
            id={name}
            name={name}
            type="text"
            defaultValue={asText(value)}
            {...maxLength(control)}
            required={required}
            className={INPUT}
          />
        </Labelled>
      )

    case 'url':
      return (
        <Labelled name={name} label={field.label} required={field.required}>
          <input
            id={name}
            name={name}
            type="url"
            inputMode="url"
            defaultValue={asText(value)}
            {...maxLength(control)}
            required={required}
            className={INPUT}
          />
        </Labelled>
      )

    case 'paragraph':
      return (
        <Labelled name={name} label={field.label} required={field.required}>
          <textarea
            id={name}
            name={name}
            rows={3}
            defaultValue={asText(value)}
            {...maxLength(control)}
            required={required}
            className={INPUT}
          />
        </Labelled>
      )

    case 'number':
      return (
        <Labelled name={name} label={field.label} required={field.required}>
          <input
            id={name}
            name={name}
            type="number"
            defaultValue={typeof value === 'number' ? String(value) : asText(value)}
            step={control.integer ? 1 : 'any'}
            {...(control.minimum === null ? {} : { min: control.minimum })}
            {...(control.maximum === null ? {} : { max: control.maximum })}
            required={required}
            className={INPUT}
          />
        </Labelled>
      )

    case 'toggle':
      return (
        <label htmlFor={name} className="flex items-center gap-2 text-sm">
          <input
            id={name}
            name={name}
            type="checkbox"
            value="yes"
            defaultChecked={value === true}
          />
          {field.label}
        </label>
      )

    case 'choice':
      return (
        <Labelled name={name} label={field.label} required={field.required}>
          <select
            id={name}
            name={name}
            defaultValue={asText(value)}
            required={required}
            className={INPUT}
          >
            {/*
             * An optional choice needs a way to say "none of these", and an
             * empty option is it. A required one does not get one, because
             * there is no answer it stands for.
             */}
            {!field.required && <option value="">Not set</option>}
            {control.values.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Labelled>
      )

    case 'choices': {
      const chosen = new Set(Array.isArray(value) ? value.map(String) : [])
      return (
        <fieldset className={FIELDSET}>
          <legend className="text-sm font-medium">{field.label}</legend>
          <div className="flex flex-wrap gap-4">
            {control.values.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  value={option}
                  defaultChecked={chosen.has(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
      )
    }

    case 'picture': {
      const src = isRecord(value) && typeof value.src === 'string' ? value.src : null
      return (
        <fieldset className={`${FIELDSET} rounded border border-slate-200 p-3`}>
          <PictureField
            name={name}
            label={field.label}
            eventId={eventId}
            uploadKind={control.uploadKind}
            currentSrc={src === null ? null : resolveAssetSrc(src)}
          />
          {control.fields.length > 0 && (
            <SectionFields
              fields={control.fields}
              value={value}
              prefix={prefix}
              eventId={eventId}
              path={path}
              enforceRequired={false}
            />
          )}
        </fieldset>
      )
    }

    case 'group':
      return (
        <fieldset className={`${FIELDSET} rounded border border-slate-200 p-3`}>
          <legend className="px-1 text-sm font-medium">{field.label}</legend>
          <SectionFields
            fields={control.fields}
            value={value}
            prefix={prefix}
            eventId={eventId}
            path={path}
            /*
             * A required group's own fields stay enforced; an optional group's
             * do not, because emptying them is how the group is removed.
             */
            enforceRequired={enforceRequired && field.required}
          />
        </fieldset>
      )

    case 'rows': {
      const rows = Array.isArray(value) ? value : []
      return (
        <fieldset className={FIELDSET}>
          <legend className="text-sm font-medium">{field.label}</legend>
          {rows.map((row, index) => (
            <div key={index} className="min-w-0 rounded border border-slate-200 p-3">
              <SectionFields
                fields={control.fields}
                value={row}
                prefix={prefix}
                eventId={eventId}
                path={[...path, index]}
                enforceRequired={enforceRequired}
              />
            </div>
          ))}
          {/*
           * No add and no remove. Which entries a list has is composition, and
           * composition belongs to the template rather than to the buyer. See
           * docs/editing.md.
           */}
        </fieldset>
      )
    }

    case 'opaque':
      return (
        <p className="rounded bg-slate-100 p-3 text-sm text-slate-600">
          <strong>{field.label}</strong> is part of this template but this version of the editor has
          no control for it. What is saved for it now is kept exactly as it is.
        </p>
      )
  }
}

const INPUT = 'w-full rounded border border-slate-300 px-3 py-2 text-sm'

/**
 * `min-w-0` is load bearing and is not a spacing choice.
 *
 * A browser's own stylesheet gives `fieldset` `min-inline-size: min-content`,
 * so a fieldset refuses to shrink below the widest thing inside it however
 * narrow its parent is. Nested three deep, as a picture inside a section or a
 * row inside a list, that pushes the whole page sideways on a phone. The
 * editor is filled in on the same phone the listing was read on, and a form
 * that scrolls sideways is a form with half its fields off screen.
 */
const FIELDSET = 'flex min-w-0 flex-col gap-3'

function Labelled({
  name,
  label,
  required,
  children,
}: {
  readonly name: string
  readonly label: string
  readonly required: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {!required && <span className="ml-2 font-normal text-slate-500">optional</span>}
      </label>
      {children}
    </div>
  )
}

function maxLength(control: FieldControl): { maxLength?: number } {
  if (control.kind !== 'line' && control.kind !== 'paragraph' && control.kind !== 'url') return {}
  return control.maxLength === null ? {} : { maxLength: control.maxLength }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}
