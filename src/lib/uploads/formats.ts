/**
 * What a file actually is, decided from its own bytes.
 *
 * Never from the filename and never from the `Content-Type` header. Both are
 * strings the uploader chooses, and this decision ends up in a column that the
 * asset route later echoes back to a browser as a `Content-Type`. A file that
 * says it is a PNG, is served as a PNG, and is in fact an HTML document is a
 * stored cross site scripting hole on the platform's own asset hostname.
 *
 * The allow list is closed and small, and the two absences are deliberate.
 *
 * **No SVG.** An SVG is a document that can carry script, and one served from
 * an origin the app also uses would be same origin with a guest page. The
 * template format already refuses it for exactly this reason
 * (`src/lib/template/primitives.ts`), and refusing it in two places is not
 * duplication: that one guards what a document may name, this one guards what
 * may exist to be named.
 *
 * **No HEIC.** iPhones shoot HEIC, so this one costs something real and is
 * worth stating rather than leaving as an oversight. sharp's prebuilt binaries
 * carry no HEIF decoder, so accepting it would mean accepting a file we then
 * fail to re-encode, which is a worse experience than a clear refusal. In
 * practice iOS converts to JPEG when a photo is picked through a file input,
 * so the common path is unaffected; a file dragged out of Files is not, and
 * gets a message that says so. Fixing it properly needs a libvips build with
 * HEIF, which is a deployment decision rather than a code one.
 */

export type UploadFormatName = 'jpeg' | 'png' | 'webp' | 'avif' | 'mp3' | 'm4a'

export type UploadFormat = {
  readonly name: UploadFormatName
  /** What the asset route serves this as. */
  readonly contentType: string
  /** Appended to the content address, so a URL still ends in something a CDN understands. */
  readonly extension: string
  readonly family: 'image' | 'audio'
}

export const UPLOAD_FORMATS: Readonly<Record<UploadFormatName, UploadFormat>> = {
  jpeg: { name: 'jpeg', contentType: 'image/jpeg', extension: 'jpg', family: 'image' },
  png: { name: 'png', contentType: 'image/png', extension: 'png', family: 'image' },
  webp: { name: 'webp', contentType: 'image/webp', extension: 'webp', family: 'image' },
  avif: { name: 'avif', contentType: 'image/avif', extension: 'avif', family: 'image' },
  mp3: { name: 'mp3', contentType: 'audio/mpeg', extension: 'mp3', family: 'audio' },
  m4a: { name: 'm4a', contentType: 'audio/mp4', extension: 'm4a', family: 'audio' },
}

/**
 * Named refusals for shapes that are common enough that "unrecognised" would be
 * an unhelpful answer.
 *
 * A buyer who drags in an SVG or a photo out of an iPhone's Files app should be
 * told which thing they did, not that their file is unreadable.
 */
const NAMED_REFUSALS: readonly {
  readonly reason: string
  readonly test: (b: Uint8Array) => boolean
}[] = [
  {
    reason:
      'SVG is not accepted. It is a document that can carry script, and one served from this ' +
      'platform would run alongside a guest page. Export it as PNG or WebP.',
    test: (bytes) => looksLikeSvg(bytes),
  },
  {
    reason:
      'HEIC photos are not accepted yet. On an iPhone, choose the photo through the photo ' +
      'picker rather than through Files and it arrives as a JPEG.',
    test: (bytes) => hasBrand(bytes, ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heis']),
  },
  {
    reason: 'GIF is not accepted. Export a still frame as PNG or WebP.',
    test: (bytes) => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a'),
  },
]

export type SniffResult =
  | { readonly ok: true; readonly format: UploadFormat }
  | { readonly ok: false; readonly reason: string }

/**
 * The format these bytes actually are, or why they are refused.
 *
 * Every check reads the leading bytes only, which is all a container format
 * puts its identity in. It is not a validation that the rest of the file is
 * well formed: that is what the re-encode step is for, and an image sharp
 * cannot decode is refused there.
 */
export function sniff(bytes: Uint8Array): SniffResult {
  /*
   * Detection runs before the named refusals, not after, and the reason is a
   * bug this had on the way in. An AVIF's compatible brand list routinely
   * carries `mif1`, which is also how a HEIC identifies itself, so a refusal
   * pass that ran first rejected perfectly good AVIF files with a message about
   * iPhones. What is recognised is accepted; the refusals only decorate the
   * failure.
   */
  const name = detect(bytes)
  if (name !== null) return { ok: true, format: UPLOAD_FORMATS[name] }

  for (const refusal of NAMED_REFUSALS) {
    if (refusal.test(bytes)) return { ok: false, reason: refusal.reason }
  }

  return {
    ok: false,
    reason:
      'that file is not one of the formats this accepts. Images may be JPEG, PNG, WebP or ' +
      'AVIF, and music may be MP3 or M4A.',
  }
}

function detect(bytes: Uint8Array): UploadFormatName | null {
  // JPEG: SOI marker, then any marker.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg'

  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'

  // RIFF container, with WEBP where the form type goes.
  if (startsWith(bytes, 'RIFF') && readAscii(bytes, 8, 4) === 'WEBP') return 'webp'

  if (hasBrand(bytes, ['avif', 'avis'])) return 'avif'

  /*
   * Container sniffing is the honest limit here, and it is the limit the plan
   * asked for. An MP4 brand says the file is an ISO base media container; it
   * does not say whether there is a video track inside. A buyer who uploads a
   * ten megabyte video gets it stored and played through an audio element,
   * which is a waste rather than a hazard. Telling the two apart needs a track
   * parser, and a track parser is the beginning of the ffmpeg pipeline v1
   * deliberately does not have.
   */
  if (hasBrand(bytes, ['M4A ', 'M4B ', 'mp42', 'mp41', 'isom', 'iso2'])) return 'm4a'

  if (startsWith(bytes, 'ID3')) return 'mp3'
  if (isMpegAudioFrame(bytes)) return 'mp3'

  return null
}

/**
 * An MPEG audio frame header: eleven set bits of sync, then a version and a
 * layer that are not the values the specification reserves.
 *
 * The reserved checks are what stop this matching arbitrary binary that happens
 * to open with two high bytes.
 */
function isMpegAudioFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false
  const [first, second] = [bytes[0]!, bytes[1]!]
  if (first !== 0xff || (second & 0xe0) !== 0xe0) return false

  const version = (second >> 3) & 0x03
  const layer = (second >> 1) & 0x03
  return version !== 0x01 && layer !== 0x00
}

/** ISO base media brand, which sits at offset 8 right after `ftyp`. */
function hasBrand(bytes: Uint8Array, brands: readonly string[]): boolean {
  if (readAscii(bytes, 4, 4) !== 'ftyp') return false
  const major = readAscii(bytes, 8, 4)
  if (major !== null && brands.includes(major)) return true

  // A compatible brand list follows the major brand and its version.
  for (let at = 16; at + 4 <= Math.min(bytes.length, 64); at += 4) {
    const brand = readAscii(bytes, at, 4)
    if (brand !== null && brands.includes(brand)) return true
  }
  return false
}

/**
 * SVG has no magic number, so this looks for the root element inside the first
 * few hundred bytes, past any XML declaration, byte order mark or comment.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = readAscii(bytes, 0, Math.min(bytes.length, 512))
  if (head === null) return false
  return /<svg[\s>]/i.test(head)
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
  return readAscii(bytes, 0, ascii.length) === ascii
}

function matches(bytes: Uint8Array, at: number, expected: readonly number[]): boolean {
  if (bytes.length < at + expected.length) return false
  return expected.every((byte, index) => bytes[at + index] === byte)
}

/** Reads a run of bytes as ASCII, or null when the file is shorter than that. */
function readAscii(bytes: Uint8Array, at: number, length: number): string | null {
  if (bytes.length < at + length) return null
  let out = ''
  for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]!)
  return out
}
