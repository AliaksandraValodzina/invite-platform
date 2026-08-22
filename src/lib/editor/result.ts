/**
 * What a save answers with.
 *
 * Its own module, with no imports, because both ends of a server action need it:
 * the action that returns it runs on the server and the form that renders it is
 * a client component, and a shared type is the only thing that should cross that
 * line.
 *
 * A failure carries `issues` with the field paths the schema named, so the buyer
 * is told which field rather than that something was wrong. It never carries the
 * value: what they typed is still in the form in front of them, and the stored
 * row is untouched because nothing was written.
 */

export type SaveIssue = {
  /** `blocks.<id>.<field>`, or the column a database refusal named. */
  readonly path: string
  readonly message: string
}

/** One load bearing detail a save would change, in the words a buyer reads. */
export type DetailChange = {
  /** What it is called on screen, such as "The date and time". */
  readonly label: string
  readonly from: string
  readonly to: string
}

export type SaveResult =
  | { readonly status: 'idle' }
  | { readonly status: 'saved'; readonly message: string }
  | {
      readonly status: 'failed'
      readonly message: string
      readonly issues: readonly SaveIssue[]
    }
  /**
   * Nothing was written, and it will be written on the next press.
   *
   * The captain's answer 5: before saving a change to the date, the time zone,
   * the venue or the address on an invitation that has replies, show how many
   * people have replied and ask. Nothing is sent to guests either way. It is a
   * confirmation and never a block: the buyer may go ahead, and this is only the
   * moment where they find out that twelve people are already holding the old
   * answer.
   */
  | {
      readonly status: 'confirm'
      readonly message: string
      /** How many people have replied, or null when that could not be read. */
      readonly replies: number | null
      readonly changes: readonly DetailChange[]
      /** The submitted form, to be replayed verbatim. See `encodeReplay`. */
      readonly replay: string
    }

export function saved(message: string): SaveResult {
  return { status: 'saved', message }
}

export function failed(message: string, issues: readonly SaveIssue[] = []): SaveResult {
  return { status: 'failed', message, issues }
}

export function confirming(
  replies: number | null,
  changes: readonly DetailChange[],
  replay: string
): SaveResult {
  /*
   * Null is not zero and must not read as it. It means the count could not be
   * established, and the honest sentence for that is the one that does not name
   * a number rather than one that names the wrong one.
   */
  const message =
    replies === null
      ? 'We could not check how many people have replied to this invitation. Nothing is sent to them either way.'
      : `${replies === 1 ? '1 person has' : `${replies} people have`} already replied to this invitation. Nothing is sent to them either way.`

  return { status: 'confirm', message, replies, changes, replay }
}

/**
 * How a pending save survives being asked about, and why it is one field.
 *
 * React resets an uncontrolled form after a form action returns. That is right
 * for a save and wrong for a question: the buyer's new date would snap back to
 * the old one while they are being asked whether to change it, and the second
 * press would then save what was already stored. So the action hands the whole
 * submitted form back as a string, the form renders it as one hidden input, and
 * confirming replays it.
 *
 * One field rather than one hidden input per value, because per-value inputs
 * would sit in the same form as the visible controls under the same names, and
 * `FormData.get` would then have to choose between two answers by document
 * order. A single field under a name nothing else uses cannot be ambiguous.
 */
export const CONFIRM_FIELD = 'confirm'
export const CONFIRM_REPLAY_FIELD = 'confirmReplay'

/** The submitted form as one string, minus the plumbing on either side of it. */
export function encodeReplay(formData: FormData): string {
  const encoded = new URLSearchParams()
  for (const [name, value] of formData.entries()) {
    if (name === CONFIRM_FIELD || name === CONFIRM_REPLAY_FIELD) continue
    /*
     * React's own server action fields, which it adds to the FormData a form
     * action receives: an action id, a key and the bound arguments. They are the
     * previous request's routing information and mean nothing on the next one,
     * so replaying them would be carrying a stale envelope inside a letter.
     */
    if (name.startsWith('$')) continue
    if (typeof value !== 'string') continue
    encoded.append(name, value)
  }
  return encoded.toString()
}

/**
 * The form a save should act on: the replayed one when this is a confirmation,
 * and the submitted one otherwise.
 *
 * Everything downstream reads a `FormData` and is unchanged by this, which is
 * the point: confirming is a property of the request rather than something each
 * field has to know about.
 */
export function replayedForm(formData: FormData): FormData {
  const encoded = formData.get(CONFIRM_REPLAY_FIELD)
  if (formData.get(CONFIRM_FIELD) !== 'yes') return formData
  if (typeof encoded !== 'string' || encoded === '') return formData

  const replay = new FormData()
  for (const [name, value] of new URLSearchParams(encoded)) replay.append(name, value)
  return replay
}

/** True when this submission is the buyer saying yes to the question above. */
export function isConfirmed(formData: FormData): boolean {
  return formData.get(CONFIRM_FIELD) === 'yes'
}
