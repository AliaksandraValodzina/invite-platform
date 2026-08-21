'use client'

import { useId, useState } from 'react'

/**
 * The one control on this page that needs JavaScript, and the reason it does is
 * worth stating: a picture is not a value a form can carry.
 *
 * Everything else in the editor is text in a box, and a browser with no
 * JavaScript posts it and gets a saved page back. A picture is bytes that have
 * to be re-encoded, content addressed and stored before anything can name them,
 * which is `POST /api/uploads`, and that has to happen before the save rather
 * than as part of it: one request carrying a whole form plus a 10 MB photograph
 * would make every save as slow as its slowest picture.
 *
 * So the file goes up on its own, and what the form carries is the id of the
 * upload row it produced. The address is never in the form at all. That is not
 * tidiness: an address in a form is an address a browser can change, and the
 * server would then be writing into a buyer's document whatever `/a/<key>` it
 * was handed. Instead the server reads the row back as this buyer, which is
 * `pictureForUpload` in src/lib/supabase/editing.ts, and row level security is
 * what says the upload is theirs.
 *
 * Without JavaScript this control degrades to what it can honestly offer: the
 * picture that is already there, and a box to remove it. Both of those are real
 * form state and both save.
 */

export type PictureFieldProps = {
  /** Input name of the picture field, which the two hidden controls hang off. */
  readonly name: string
  readonly label: string
  readonly eventId: string
  readonly uploadKind: 'image' | 'envelope'
  /** Where the current picture is served from, already host resolved, or null. */
  readonly currentSrc: string | null
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading' }
  | { readonly kind: 'ready'; readonly preview: string }
  | { readonly kind: 'failed'; readonly message: string }

export function PictureField({ name, label, eventId, uploadKind, currentSrc }: PictureFieldProps) {
  const [uploadId, setUploadId] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const fileId = useId()
  const clearId = useId()

  async function upload(file: File): Promise<void> {
    setStatus({ kind: 'uploading' })

    const body = new FormData()
    body.set('kind', uploadKind)
    body.set('eventId', eventId)
    body.set('file', file)

    let response: Response
    try {
      response = await fetch('/api/uploads', { method: 'POST', body })
    } catch {
      setStatus({ kind: 'failed', message: 'That could not be sent. Check your connection.' })
      return
    }

    const result = (await response.json().catch(() => null)) as {
      ok?: boolean
      id?: string
      message?: string
    } | null

    if (response.ok && result?.ok === true && typeof result.id === 'string') {
      setUploadId(result.id)
      /*
       * The preview is the file in the browser's own memory rather than the
       * stored object, because the stored object is what the next save will
       * name and nothing is saved yet. Showing the address now would show a
       * picture that is not on the invitation.
       */
      setStatus({ kind: 'ready', preview: URL.createObjectURL(file) })
      return
    }

    setUploadId('')
    setStatus({
      kind: 'failed',
      message: result?.message ?? 'That could not be saved. Try a different file.',
    })
  }

  const preview = status.kind === 'ready' ? status.preview : currentSrc

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>

      {preview !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt=""
          data-picture-preview={name}
          className="max-h-32 w-auto rounded border border-slate-200 object-contain"
        />
      )}

      <input type="hidden" name={`${name}.upload`} value={uploadId} />

      <input
        id={fileId}
        type="file"
        accept="image/*"
        data-picture-input={name}
        className="text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined) void upload(file)
        }}
      />

      {status.kind === 'uploading' && <p className="text-sm text-slate-600">Sending the file...</p>}
      {status.kind === 'ready' && (
        <p className="text-sm text-slate-600">Ready. Save to put it on the invitation.</p>
      )}
      {status.kind === 'failed' && (
        <p className="text-sm text-red-700" data-picture-error={name}>
          {status.message}
        </p>
      )}

      {currentSrc !== null && (
        <label htmlFor={clearId} className="flex items-center gap-2 text-sm text-slate-600">
          <input id={clearId} type="checkbox" name={`${name}.clear`} value="yes" />
          Remove this picture
        </label>
      )}
    </div>
  )
}
