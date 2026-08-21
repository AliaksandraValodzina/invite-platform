import 'server-only'

import { insertUpload, queueOrphanObjects, type UploadVariantRow } from '@/lib/supabase/uploads'

import { contentAddress, sha256Hex } from './address'
import { encodeUpload } from './encode'
import { sniff } from './formats'
import { assetUrl, readAssetHostConfig } from './host'
import { UPLOAD_KIND_SPECS, UPLOAD_MAX_BYTES, type UploadKind } from './kinds'
import { objectStore, type ObjectStore } from './store'

/**
 * One path in, for all three uses.
 *
 * This is the function the whole stage exists to have exactly one of. A buyer's
 * photograph, the music file and the envelope artwork differ in a row of
 * `UPLOAD_KIND_SPECS` and in nothing else: same size limit, same sniffing, same
 * content addressing, same object store, same rows, same retention, same
 * paragraph of terms. Every route calls this; nothing else writes to the store.
 *
 * The order of operations is the interesting part, and it is chosen so that
 * every failure leaves something recoverable.
 *
 *   1. Size, then format, then re-encode. All three are cheap refusals that
 *      happen before anything is written, so a rejected upload leaves no trace.
 *   2. Bytes into the store, THEN the row. A row that points at objects which
 *      do not exist is a broken image on a live page; objects with no row are a
 *      few kilobytes nobody references, and the queue below tidies them. Those
 *      two failures are not the same size, so the cheap one is the one this
 *      risks.
 *   3. If the row is refused, the keys are queued for deletion. The queue's
 *      reference check is what makes that safe: content addressed keys are
 *      shared, so a file that another event also uploaded is not removed.
 *
 * Limits are re-stated here as a courtesy and enforced in the database as a
 * guarantee. The check in this file is what turns "too many photos" into a
 * sentence; the trigger in `20260821010300_uploads.sql` is what makes it true
 * when two uploads are in flight at once.
 */

export type IngestInput = {
  readonly eventId: string
  readonly kind: UploadKind
  readonly bytes: Uint8Array
}

export type IngestedVariant = {
  readonly label: string
  readonly key: string
  /** Built from the key at response time, never stored. See `./host.ts`. */
  readonly url: string
  readonly contentType: string
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
}

export type IngestOutcome =
  | {
      readonly kind: 'stored'
      readonly id: string
      readonly uploadKind: UploadKind
      /** True when these exact bytes were already here, so nothing new was written. */
      readonly deduplicated: boolean
      /** What the buyer sent. */
      readonly originalBytes: number
      /** What will be served, summed across every derivative. */
      readonly storedBytes: number
      readonly variants: readonly IngestedVariant[]
    }
  /** The buyer can fix this: wrong format, too big, too many, out of budget. */
  | { readonly kind: 'refused'; readonly reason: string; readonly status: 400 | 409 | 413 }
  /** Our fault. The buyer is told to try again rather than told what broke. */
  | { readonly kind: 'unavailable'; readonly reason: string }

export async function ingestUpload(
  input: IngestInput,
  store: ObjectStore = objectStore()
): Promise<IngestOutcome> {
  const spec = UPLOAD_KIND_SPECS[input.kind]

  if (input.bytes.byteLength === 0) {
    return { kind: 'refused', reason: 'that file is empty.', status: 400 }
  }

  if (input.bytes.byteLength > UPLOAD_MAX_BYTES) {
    return {
      kind: 'refused',
      status: 413,
      reason: `that file is ${megabytes(input.bytes.byteLength)} MB, and the limit is ${megabytes(UPLOAD_MAX_BYTES)} MB per file.`,
    }
  }

  const sniffed = sniff(input.bytes)
  if (!sniffed.ok) return { kind: 'refused', reason: sniffed.reason, status: 400 }

  if (!spec.accepts.includes(sniffed.format.name)) {
    return {
      kind: 'refused',
      status: 400,
      reason: `a ${spec.label} may not be ${sniffed.format.name.toUpperCase()}. This one accepts ${spec.accepts.join(', ')}.`,
    }
  }

  const encoded = await encodeUpload(input.kind, input.bytes, sniffed.format)
  if (!encoded.ok) return { kind: 'refused', reason: encoded.reason, status: 400 }

  /*
   * Where the original is kept.
   *
   * For a kind that is re-encoded, the original is a separate object with its
   * own address, and the retention sweep discards it thirty days after
   * publication. For a kind stored as it arrived, which is audio, the original
   * IS the served object, so it shares that key rather than being written
   * twice. The discard sweep then queues a key that a live variant still
   * references, and the queue's reference check leaves the bytes alone. That is
   * the same mechanism that stops one event's takedown blanking another's page,
   * used here for a second purpose rather than special cased.
   */
  const originalKey =
    spec.encode === 'none'
      ? encoded.variants[0]!.key
      : contentAddress(input.bytes, { label: 'orig', extension: sniffed.format.extension })

  const written: string[] = []
  try {
    if (spec.encode !== 'none') {
      await store.put({
        key: originalKey,
        contentType: sniffed.format.contentType,
        bytes: input.bytes,
      })
      written.push(originalKey)
    }

    for (const variant of encoded.variants) {
      await store.put({
        key: variant.key,
        contentType: variant.contentType,
        bytes: variant.bytes,
      })
      written.push(variant.key)
    }
  } catch (error) {
    await queueOrphanObjects(written)
    return { kind: 'unavailable', reason: describe(error) }
  }

  const variantRows: UploadVariantRow[] = encoded.variants.map((variant) => ({
    label: variant.label,
    key: variant.key,
    content_type: variant.contentType,
    bytes: variant.bytes.byteLength,
    width: variant.width,
    height: variant.height,
  }))

  const variantBytes = variantRows.reduce((total, variant) => total + variant.bytes, 0)

  const stored = await insertUpload({
    eventId: input.eventId,
    kind: input.kind,
    bytes: input.bytes.byteLength,
    contentType: sniffed.format.contentType,
    sha256Hex: sha256Hex(input.bytes),
    originalKey,
    variants: variantRows,
    variantBytes,
  })

  if (stored.kind === 'refused') {
    await queueOrphanObjects(written)
    return { kind: 'refused', ...refusal(stored.code, input.kind) }
  }

  if (stored.kind === 'unavailable') {
    await queueOrphanObjects(written)
    return { kind: 'unavailable', reason: stored.reason }
  }

  const host = readAssetHostConfig()

  return {
    kind: 'stored',
    id: stored.row.id,
    uploadKind: input.kind,
    deduplicated: stored.kind === 'already-stored',
    originalBytes: stored.row.bytes,
    storedBytes: stored.row.variantBytes,
    variants: stored.row.variants.map((variant) => ({
      label: variant.label,
      key: variant.key,
      url: assetUrl(variant.key, host),
      contentType: variant.content_type,
      bytes: variant.bytes,
      width: variant.width,
      height: variant.height,
    })),
  }
}

function refusal(
  code: 'UP413' | 'UP409' | 'UP507',
  kind: UploadKind
): { readonly reason: string; readonly status: 400 | 409 | 413 } {
  const spec = UPLOAD_KIND_SPECS[kind]

  switch (code) {
    case 'UP413':
      return {
        status: 413,
        reason: `that file is over the ${megabytes(UPLOAD_MAX_BYTES)} MB limit per file.`,
      }
    case 'UP409':
      return {
        status: 409,
        reason:
          spec.perEvent === 1
            ? `this invitation already has a ${spec.label}. Remove it before adding another.`
            : `this invitation already has ${spec.perEvent} ${spec.label}s, which is the limit.`,
      }
    case 'UP507':
      return {
        status: 409,
        reason:
          'this invitation has reached the total size it may hold. Remove something before ' +
          'adding more.',
      }
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace(/\.0$/, '')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the object store could not be reached'
}
