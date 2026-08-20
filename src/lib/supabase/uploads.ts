import 'server-only'

import { z } from 'zod'

import type { UploadKind } from '@/lib/uploads/kinds'

import { serviceGet, servicePost, type ServiceResponse } from './service'

/**
 * The uploads table, as the server reaches it.
 *
 * Writes go through the service role, like every other write a guest or an
 * anonymous request can reach, and unlike the dashboard, which reads as the
 * buyer so that row level security is the check. The API route is what proves
 * the buyer owns the event, and it does that by reading the event AS them
 * (`src/lib/supabase/buyer.ts`) before this module writes anything. So the
 * ownership check is still the database's, and this module never takes an
 * `owner_id` from a request: the table's trigger sets it from the event.
 *
 * Nothing here is cached at any layer. An upload is a write and the list of an
 * event's assets is read by the buyer who is editing them, which is the one
 * audience for whom a minute-old answer is useless.
 */

/** SQLSTATEs raised by 20260821010300_uploads.sql, so a route can answer specifically. */
export const UPLOAD_ERRORS = {
  UP413: 'too-large',
  UP409: 'kind-full',
  UP507: 'budget-full',
} as const

const variantSchema = z.object({
  label: z.string(),
  key: z.string(),
  content_type: z.string(),
  bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
})

const rowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  kind: z.string(),
  bytes: z.number(),
  content_type: z.string(),
  variants: z.array(variantSchema),
  variant_bytes: z.number(),
  created_at: z.string(),
})

export type UploadVariantRow = z.infer<typeof variantSchema>

export type UploadRow = {
  readonly id: string
  readonly eventId: string
  readonly kind: string
  /** The original, as uploaded. */
  readonly bytes: number
  readonly contentType: string
  readonly variants: readonly UploadVariantRow[]
  readonly variantBytes: number
  readonly createdAt: string
}

export type InsertUploadInput = {
  readonly eventId: string
  readonly kind: UploadKind
  readonly bytes: number
  readonly contentType: string
  readonly sha256Hex: string
  readonly originalKey: string
  readonly variants: readonly UploadVariantRow[]
  readonly variantBytes: number
}

export type InsertUploadOutcome =
  | { readonly kind: 'stored'; readonly row: UploadRow }
  /** The same file was already uploaded for this use. One row, one object. */
  | { readonly kind: 'already-stored'; readonly row: UploadRow }
  | { readonly kind: 'refused'; readonly code: keyof typeof UPLOAD_ERRORS; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Stores one row, or reports which limit refused it.
 *
 * The limits are checked in the database rather than here, and the reason is
 * that two uploads in flight can both pass a count-then-insert in application
 * code. A trigger on the insert cannot be raced, and it cannot be forgotten by
 * the next route that writes to this table. What this function does is turn its
 * SQLSTATE back into something a person can read.
 */
export async function insertUpload(input: InsertUploadInput): Promise<InsertUploadOutcome> {
  const existing = await findUploadByDigest(input.eventId, input.kind, input.sha256Hex)
  if (existing.kind === 'unavailable') return existing
  if (existing.kind === 'found') return { kind: 'already-stored', row: existing.row }

  let response: ServiceResponse
  try {
    response = await servicePost(
      'uploads',
      {
        event_id: input.eventId,
        kind: input.kind,
        bytes: input.bytes,
        content_type: input.contentType,
        // PostgREST takes bytea in Postgres hex input format.
        sha256: `\\x${input.sha256Hex}`,
        original_key: input.originalKey,
        variants: input.variants,
        variant_bytes: input.variantBytes,
      },
      { prefer: 'return=representation' }
    )
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

  if (!response.ok) {
    const code = errorCode(response.json)

    if (code !== null && code in UPLOAD_ERRORS) {
      return {
        kind: 'refused',
        code: code as keyof typeof UPLOAD_ERRORS,
        detail: response.detail,
      }
    }

    /*
     * A unique violation here is the dedupe index and it means somebody else
     * stored the same file for the same event between the read above and this
     * insert. The right answer is the row they wrote, not an error: the bytes
     * are already in the store at the same content address, so the two requests
     * genuinely produced one object.
     */
    if (code === '23505') {
      const raced = await findUploadByDigest(input.eventId, input.kind, input.sha256Hex)
      if (raced.kind === 'found') return { kind: 'already-stored', row: raced.row }
    }

    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }

  const parsed = rowSchema.safeParse(
    Array.isArray(response.json) ? response.json[0] : response.json
  )
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'the upload was stored but could not be confirmed' }
  }

  return { kind: 'stored', row: toRow(parsed.data) }
}

type FindOutcome =
  | { readonly kind: 'found'; readonly row: UploadRow }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly reason: string }

export async function findUploadByDigest(
  eventId: string,
  kind: UploadKind,
  digestHex: string
): Promise<FindOutcome> {
  const params = new URLSearchParams({
    event_id: `eq.${eventId}`,
    kind: `eq.${kind}`,
    sha256: `eq.\\x${digestHex}`,
    deleted_at: 'is.null',
    select: 'id,event_id,kind,bytes,content_type,variants,variant_bytes,created_at',
    limit: '1',
  })

  let response: ServiceResponse
  try {
    response = await serviceGet(`uploads?${params.toString()}`, { revalidate: false })
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

  if (!response.ok)
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  if (!Array.isArray(response.json) || response.json.length === 0) return { kind: 'absent' }

  const parsed = rowSchema.safeParse(response.json[0])
  if (!parsed.success)
    return { kind: 'unavailable', reason: 'an uploads row was not the shape this deploy expects' }

  return { kind: 'found', row: toRow(parsed.data) }
}

/** Every live upload for one event, for the buyer's own editing surface. */
export async function listEventUploads(eventId: string): Promise<UploadRow[] | null> {
  const params = new URLSearchParams({
    event_id: `eq.${eventId}`,
    deleted_at: 'is.null',
    select: 'id,event_id,kind,bytes,content_type,variants,variant_bytes,created_at',
    order: 'created_at.asc',
  })

  let response: ServiceResponse
  try {
    response = await serviceGet(`uploads?${params.toString()}`, { revalidate: false })
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(response.json)) return null

  const rows: UploadRow[] = []
  for (const row of response.json) {
    const parsed = rowSchema.safeParse(row)
    if (parsed.success) rows.push(toRow(parsed.data))
  }
  return rows
}

/**
 * Takedown for one asset.
 *
 * Returns true when this call was the one that disabled it, false when it was
 * already disabled or does not exist. The route deliberately answers the same
 * either way: whether a given asset id exists is not something an unauthorised
 * caller should learn from a status code.
 */
export async function disableUpload(uploadId: string, reason: string): Promise<boolean> {
  try {
    const response = await servicePost('rpc/disable_upload', {
      p_upload_id: uploadId,
      p_reason: reason,
    })
    return response.ok && response.json === true
  } catch {
    return false
  }
}

/** Queues object keys whose row was never written, so nothing is orphaned. */
export async function queueOrphanObjects(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await servicePost('rpc/queue_upload_object', { p_key: key })
    } catch {
      /*
       * Best effort by design. The row this would have belonged to does not
       * exist, so nothing is broken by the object surviving; it is a few
       * kilobytes nobody references. Failing the buyer's upload a second time
       * over tidiness would be the wrong trade.
       */
    }
  }
}

function toRow(row: z.infer<typeof rowSchema>): UploadRow {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    bytes: row.bytes,
    contentType: row.content_type,
    variants: row.variants,
    variantBytes: row.variant_bytes,
    createdAt: row.created_at,
  }
}

/** PostgREST puts the SQLSTATE in `code` on an error body. */
function errorCode(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const code = (json as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
