/**
 * Uploads: one capability, three uses.
 *
 * Buyer photographs, the one music file and the envelope artwork all need
 * somewhere to put bytes, a size limit, a list of formats, a rule about who
 * answers for the content, and a schedule for throwing it away. This is that,
 * built once. `docs/uploads.md` is the map.
 *
 * The store itself and the ingest path are deliberately NOT re-exported here.
 * Both are `server-only`, and a barrel that pulls them in would drag the object
 * store into anything that wanted a limit constant. Import `./ingest` and
 * `./store` directly, from a route.
 */

export {
  ADDRESS_LENGTH,
  ASSET_CACHE_CONTROL,
  ASSET_KEY_PATTERN,
  ASSET_MAX_AGE_SECONDS,
  ASSET_PATH_PREFIX,
  assetETag,
  contentAddress,
  isAssetKey,
  sha256Hex,
} from './address'

export {
  MAX_INPUT_PIXELS,
  WEBP_QUALITY,
  encodeUpload,
  type EncodeOutcome,
  type EncodedVariant,
} from './encode'

export {
  UPLOAD_FORMATS,
  sniff,
  type SniffResult,
  type UploadFormat,
  type UploadFormatName,
} from './formats'

export {
  VENDOR_HOST_SUFFIXES,
  assetUrl,
  isVendorHost,
  readAssetHostConfig,
  resolveAssetSrc,
  type AssetHostConfig,
} from './host'

export {
  UPLOAD_EVENT_VARIANT_BUDGET,
  UPLOAD_KINDS,
  UPLOAD_KIND_SPECS,
  UPLOAD_MAX_BYTES,
  isUploadKind,
  type UploadKind,
  type UploadKindSpec,
} from './kinds'
