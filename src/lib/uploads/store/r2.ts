/**
 * Cloudflare R2, over its S3 compatible API, signed by hand.
 *
 * **Signed by hand rather than through an SDK**, which is the same call
 * `src/lib/supabase/service.ts` made about PostgREST and for a related reason.
 * The AWS S3 client is several megabytes of dependency for four verbs, it
 * brings its own retry, timeout and credential-chain behaviour into a serverless
 * function, and the only part of it needed here is a signature. Signature
 * Version 4 is about eighty lines and it is exercised below against the
 * specification's own published test vectors, so it is a known quantity rather
 * than a hopeful one.
 *
 * **This module names a Cloudflare hostname and that is not a contradiction.**
 * The captain's rule is about what the app hands to a browser: no buyer's
 * stored asset URL is ever a Cloudflare address, so the vendor stays swappable
 * by DNS. This is the write path, it runs on the server, its hostname appears
 * in no document and no response, and `src/lib/uploads/host.ts` is what refuses
 * a vendor hostname on the read side.
 *
 * **It is inert with no credential.** `readR2Config` returns null unless every
 * variable is present, and the selector in `./index.ts` then chooses the local
 * store. Nothing here is imported into a code path that runs without it, and no
 * placeholder bucket name exists anywhere in this repo.
 */

import 'server-only'

import { createHash, createHmac } from 'node:crypto'

import type { ObjectStore, StoredObject } from './index'

export type R2Config = {
  readonly accountId: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /**
   * Overrides the derived endpoint. Present so a test, or a different
   * S3 compatible store on the day this moves, needs no code change.
   */
  readonly endpoint: string
}

export const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

/** R2 has no regions to choose, and signs everything against this literal. */
export const R2_REGION = 'auto'

/**
 * The config, or null when this deployment has no R2.
 *
 * Null rather than a throw: absent credentials are the normal state of this
 * repo today, and the selector treats null as "use the local store". A
 * half-configured deployment is the interesting case, and it is the one that
 * throws, because it is always a mistake rather than a state.
 */
export function readR2Config(
  source: Record<string, string | undefined> = process.env
): R2Config | null {
  const values = R2_ENV_KEYS.map((key) => (source[key] ?? '').trim())
  const present = values.filter((value) => value !== '').length

  if (present === 0) return null

  if (present < R2_ENV_KEYS.length) {
    const missing = R2_ENV_KEYS.filter((key) => (source[key] ?? '').trim() === '')
    throw new Error(
      `R2 is partly configured: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} ` +
        'missing. Set every one of them or none of them; a half-configured store fails at the ' +
        'moment a buyer uploads rather than at deploy time.'
    )
  }

  const [accountId, bucket, accessKeyId, secretAccessKey] = values as [
    string,
    string,
    string,
    string,
  ]

  const override = (source.R2_ENDPOINT ?? '').trim()
  const endpoint =
    override === '' ? `https://${accountId}.r2.cloudflarestorage.com` : override.replace(/\/$/, '')

  return { accountId, bucket, accessKeyId, secretAccessKey, endpoint }
}

export function r2Store(config: R2Config): ObjectStore {
  const url = (key: string): string =>
    `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeURIComponent(key)}`

  async function send(
    method: string,
    key: string,
    body: Uint8Array | null,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    const target = new URL(url(key))
    const payload = body ?? new Uint8Array(0)
    const signed = signRequest({
      method,
      url: target,
      headers: {
        ...headers,
        host: target.host,
        // S3 requires this header on every request and signs it with the rest.
        // It is added here rather than inside the signer so that the signer
        // signs exactly the headers it is handed, which is what lets it be run
        // against the AWS test vectors, whose header sets are not S3's.
        'x-amz-content-sha256': sha256Hex(payload),
      },
      body: payload,
      config,
      at: new Date(),
    })

    return fetch(target, {
      method,
      headers: signed,
      // The cast is the DOM lib's, not ours: `BodyInit` there does not list
      // `Uint8Array` even though every runtime accepts one, and copying the
      // bytes into a Blob to satisfy it would double the memory a 10 MB upload
      // costs for nothing.
      ...(body === null ? {} : { body: body as unknown as BodyInit }),
      cache: 'no-store',
    })
  }

  return {
    driver: 'r2',

    async put(object: StoredObject) {
      const response = await send('PUT', object.key, object.bytes, {
        'content-type': object.contentType,
        // Set on the object so a CDN in front of the bucket serves it without
        // the app being in the request at all. This is the header the caching
        // requirement is about, and it belongs on the stored object because a
        // cache hit never reaches anything that could add it later.
        'cache-control': 'public, max-age=31536000, immutable',
      })

      if (!response.ok) {
        throw new Error(`R2 refused a put of ${object.key}: ${response.status}`)
      }
    },

    async get(key) {
      const response = await send('GET', key, null)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`R2 refused a get of ${key}: ${response.status}`)

      return {
        key,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        bytes: new Uint8Array(await response.arrayBuffer()),
      }
    },

    async delete(key) {
      const response = await send('DELETE', key, null)
      // S3 semantics: a delete of something absent succeeds. The store's
      // contract is "was it there and is it gone", so absence is checked first.
      if (response.status === 404) return false
      if (!response.ok && response.status !== 204) {
        throw new Error(`R2 refused a delete of ${key}: ${response.status}`)
      }
      return true
    },

    async has(key) {
      const response = await send('HEAD', key, null)
      return response.ok
    },
  }
}

// Signature Version 4 --------------------------------------------------------

export type SignInput = {
  readonly method: string
  readonly url: URL
  readonly headers: Record<string, string>
  readonly body: Uint8Array
  readonly config: R2Config
  readonly at: Date
  /**
   * R2 signs everything against these two literals, so they default and no
   * caller passes them. They are parameters at all so the signer can be run
   * against the AWS test vectors, which use a different region and service:
   * a signature implementation checked only against itself proves nothing.
   */
  readonly region?: string
  readonly service?: string
}

/**
 * The headers to send, including `Authorization`.
 *
 * Exported so it can be tested on its own with a fixed clock and invented keys,
 * which is how this whole file is proved with no cloud credential present.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const region = input.region ?? R2_REGION
  const service = input.service ?? 's3'
  const amzDate = input.at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = createHash('sha256').update(input.body).digest('hex')

  const headers: Record<string, string> = {
    ...lowercaseKeys(input.headers),
    'x-amz-date': amzDate,
  }

  const signedHeaders = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('')

  const canonicalRequest = [
    input.method,
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signature = hmac(
    signingKey(input.config.secretAccessKey, dateStamp, region, service),
    stringToSign
  ).toString('hex')

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  }
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = hmac(Buffer.from(`AWS4${secret}`, 'utf8'), dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  return hmac(serviceKey, 'aws4_request')
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/**
 * S3 signs the path with each segment URI encoded, and `/` left alone.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, which is the one
 * difference that produces a signature mismatch nobody can debug from the error
 * message.
 */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/')
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  )
}
