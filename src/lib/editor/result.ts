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

export type SaveResult =
  | { readonly status: 'idle' }
  | { readonly status: 'saved'; readonly message: string }
  | {
      readonly status: 'failed'
      readonly message: string
      readonly issues: readonly SaveIssue[]
    }

export function saved(message: string): SaveResult {
  return { status: 'saved', message }
}

export function failed(message: string, issues: readonly SaveIssue[] = []): SaveResult {
  return { status: 'failed', message, issues }
}
