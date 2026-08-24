import { COMPOSITION_FIELD, compositionValue, type CompositionView } from '@/lib/editor'

/**
 * Which sections the invitation has, in what order, and what can be put back.
 *
 * Every control is a submit button carrying its own command, so the panel works
 * with no JavaScript at all and one press is one whole saved order rather than
 * an edit somebody has to remember to commit. There is no drag and drop, which
 * is the same refusal the guided form makes: buyers of an $18 to $49 invitation
 * expect "fill in and done", and a drag target on a phone is where an editor
 * starts becoming the tarpit AGENTS.md warns about.
 *
 * The move buttons are always rendered, including on the first and last rows.
 * A control that disappears at the ends is a control whose position moves as you
 * use it, which on a phone means the button under your thumb is a different
 * button by the time you press it again. Pressing "up" on the first section says
 * so and changes nothing.
 */

export function CompositionPanel({
  view,
  live,
}: {
  readonly view: CompositionView
  /** True when guests can open the invitation right now. */
  readonly live: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {live && (
        <p
          data-testid="composition-live"
          className="rounded bg-amber-50 p-3 text-sm text-amber-900"
        >
          This invitation is live, and there is no draft. Each change here is what guests see the
          moment you make it, one whole section list at a time, so nobody ever loads a half
          rearranged page. If you would rather they did not watch, take it down at the bottom of
          this page and put it back up when you are done.
        </p>
      )}

      {view.unknown.length > 0 && (
        <p className="rounded bg-slate-100 p-3 text-sm text-slate-600">
          This invitation&apos;s order also names {view.unknown.join(', ')}, which this template no
          longer has a section for. It is not drawn, and the next change you make here will stop
          naming it. Anything you wrote in it is kept.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {view.present.map((section, index) => (
          <li
            key={section.id}
            data-composition-section={section.id}
            className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-3"
          >
            <span className="mr-auto text-sm font-medium">
              {index + 1}. {section.label}
            </span>

            <Command kind="up" id={section.id} label={`Move ${section.label} up`}>
              Up
            </Command>
            <Command kind="down" id={section.id} label={`Move ${section.label} down`}>
              Down
            </Command>
            <Command kind="remove" id={section.id} label={`Remove ${section.label}`}>
              Remove
            </Command>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Taken out</p>

        {view.removed.length === 0 ? (
          <p data-testid="nothing-removed" className="text-sm text-slate-600">
            Every section this template has is on your invitation. Anything you take out appears
            here, with what you wrote in it, so you can put it back.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.removed.map((section) => (
              <li
                key={section.id}
                data-removed-section={section.id}
                className="flex flex-wrap items-center gap-2 rounded border border-dashed border-slate-300 p-3"
              >
                <span className="mr-auto text-sm">
                  {section.label}
                  {section.hasWords && (
                    <span className="ml-2 text-slate-500">what you wrote in it is kept</span>
                  )}
                </span>
                <Command kind="add" id={section.id} label={`Put ${section.label} back`}>
                  Put it back
                </Command>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
       * There is no list of designs to add from here, and that is a decision
       * rather than an omission. A catalogue with more than one design per
       * section type is the other half of this stage, and how big it can be is
       * set by an authoring pipeline nobody has decided on yet. A picker that
       * offered sections with nothing behind them would be a promise the product
       * cannot keep. See docs/composition.md.
       */}
      <p className="text-sm text-slate-600">
        These are the sections the template you bought comes with. Choosing a different design for
        one is not available yet.
      </p>
    </div>
  )
}

function Command({
  kind,
  id,
  label,
  children,
}: {
  readonly kind: 'up' | 'down' | 'remove' | 'add'
  readonly id: string
  /** The accessible name, which says which section as well as what happens. */
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      name={COMPOSITION_FIELD}
      value={compositionValue(kind, id)}
      aria-label={label}
      className="rounded border border-slate-300 px-3 py-1 text-sm"
    >
      {children}
    </button>
  )
}
