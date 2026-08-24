import {
  ACCENT_INK_FIELD,
  BUYER_COLOUR_ROLES,
  COLOUR_LABELS,
  accentInkChoiceOf,
  colourFieldName,
  contrastFindings,
  type PaletteColours,
} from '@/lib/editor'

/**
 * The buyer's colours: seven swatches, one choice, and a legibility readout.
 *
 * Seven and not eight, because `accentInk` is not a colour a buyer picks. The
 * token schema pins it to the same value as `bg` or `surface`, since a label on
 * an accent fill drawn in `ink` failed in all three design directions at about
 * 2:1 (src/lib/template/theme.ts). Offering it as an eighth swatch would offer a
 * rule the schema then refuses, so it is offered as the choice it is, and the
 * failing pairing is unreachable from this form rather than merely unused.
 *
 * The readout is of the palette as SAVED, not as currently typed, because it is
 * rendered on the server and there is no JavaScript here to recompute it. That
 * is the honest thing it can say: after a save the page comes back with the
 * numbers for what was saved. It reports and never refuses. The palette belongs
 * to the buyer, and a product that argued with the person who paid for it over a
 * colour would be worse than one that tells them their guests will struggle.
 */

export function PaletteFields({ colours }: { readonly colours: PaletteColours }) {
  const findings = contrastFindings(colours)
  const failing = findings.filter((finding) => !finding.passes)
  const accentInk = accentInkChoiceOf(colours)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        {BUYER_COLOUR_ROLES.map((role) => (
          <div key={role} className="flex min-w-40 flex-1 flex-col gap-1">
            <label htmlFor={`colour-${role}`} className="text-sm font-medium">
              {COLOUR_LABELS[role]}
            </label>
            <input
              id={`colour-${role}`}
              name={colourFieldName(role)}
              type="color"
              defaultValue={colours[role]}
              className="h-10 w-full rounded border border-slate-300"
            />
            {/*
             * The hex beside the swatch, because a colour input shows a colour
             * and a buyer comparing this page with a brand or a printed card is
             * comparing values. It is also the only thing readable in a
             * screenshot of a failed test.
             */}
            <p data-colour={role} className="font-mono text-xs text-slate-500">
              {colours[role]}
            </p>
          </div>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">{COLOUR_LABELS.accentInk}</legend>
        <p className="text-sm text-slate-600">
          A button label is drawn in one of the two page colours rather than in the text colour, so
          that it stays readable on the highlight behind it.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={ACCENT_INK_FIELD}
            value="bg"
            defaultChecked={accentInk === 'bg'}
          />
          The page colour
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={ACCENT_INK_FIELD}
            value="surface"
            defaultChecked={accentInk === 'surface'}
          />
          The card colour
        </label>
      </fieldset>

      <div data-testid="contrast-readout" className="rounded bg-slate-50 p-3 text-sm">
        <p className="font-medium">
          {failing.length === 0
            ? 'Every pair of these clears the contrast a guest needs to read them.'
            : `${failing.length === 1 ? 'One pair is' : `${failing.length} pairs are`} hard to read. You can still save this; guests will find those parts difficult.`}
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {findings.map((finding) => (
            <li
              key={`${finding.foreground}:${finding.background}`}
              data-contrast={`${finding.foreground}-on-${finding.background}`}
              data-passes={finding.passes ? 'yes' : 'no'}
              className={finding.passes ? 'text-slate-600' : 'text-red-700'}
            >
              {finding.usedFor}: {finding.ratio.toFixed(2)} to 1, needs{' '}
              {finding.required.toFixed(1)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
