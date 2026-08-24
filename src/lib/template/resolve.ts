/**
 * The read path. Four stored jsonb values in, one renderable page out, or a
 * designed error state. Nothing here throws and nothing here writes.
 *
 * What happens when something does not validate is the decision this file is
 * really about, and the rule it follows is: fall back when the fallback is a
 * designed artifact, fail when the fallback would be a lie.
 *
 *   definition invalid     fail. There is no structure to render.
 *   theme invalid          fail. Blocks consume tokens and nothing else.
 *   content invalid        fail. Falling back to template defaults would show a
 *                          real couple's guests the placeholder names we ship
 *                          in the template. That is worse than a designed
 *                          "something went wrong" page, and it is the kind of
 *                          worse that ends up in a shop review.
 *   theme override invalid degrade. Fall back to the template theme and report
 *                          it. A palette is not somebody's words, and a
 *                          correct page in the wrong palette still serves.
 *   envelope override      degrade. Fall back to the template's envelope and
 *     invalid              report it. Same reason: the cover is not the
 *                          invitation, and the invitation still serves.
 *   one block's override   omit that block, render the rest, report it. The
 *     invalid              only block that can ever be omitted is one whose
 *                          buyer content we cannot trust, and the template
 *                          default is not a stand-in for a buyer's words.
 *   every block omitted    fail. An empty page is not a page.
 *   a composed section     skip it, render the rest, report it. A template can
 *     names no known block  genuinely lose a block, and an invitation that went
 *                          dark because of a change we made to a template is a
 *                          failure the buyer cannot see the cause of.
 *
 * Nothing is deleted or rewritten in any of those cases. Every rejected value
 * comes back in the outcome, verbatim, so it can be logged and repaired.
 *
 * Which sections a page has, and in what order, is the buyer's
 * `content.sections` when they have one and the template's own block order when
 * they have not. See ./composition.ts.
 */

import { BLOCK_CONFIG_SCHEMAS } from './blocks'
import { composeSections } from './composition'
import { eventContentPipeline, type EventContent } from './content'
import { envelopeConfigSchema, UNIVERSAL_ENVELOPE, type EnvelopeConfig } from './envelope'
import {
  isJsonObject,
  toIssues,
  type DocumentIssue,
  type DocumentPipeline,
  type LoadFailureReason,
} from './document'
import {
  templateDefinitionPipeline,
  type BlockConfigSchemas,
  type TemplateDefinition,
} from './definition'
import {
  mergeThemeTokens,
  themeOverridePipeline,
  themePipeline,
  themeToCssVariables,
  type ThemeDocument,
  type ThemeOverrideDocument,
  type ThemeTokens,
} from './theme'

/** The four jsonb values a guest page request has in hand. */
export type StoredEventDocuments = {
  /** templates.definition */
  readonly definition: unknown
  /** templates.theme */
  readonly theme: unknown
  /** event_content.content */
  readonly content: unknown
  /** event_content.theme */
  readonly themeOverride: unknown
}

export type DocumentName = 'definition' | 'theme' | 'content' | 'theme override'

export type OmittedBlock = {
  readonly id: string
  readonly type: string
  readonly issues: readonly DocumentIssue[]
  /** The buyer's stored override, untouched. */
  readonly storedOverride: unknown
}

export type OrphanedContent = {
  readonly id: string
  readonly storedOverride: unknown
}

export type ResolvedPage<Block> = {
  readonly blocks: readonly Block[]
  /**
   * The cover, always present and never null. An empty object is the universal
   * envelope rather than the absence of one, which is why this is not
   * `EnvelopeConfig | null`: a guest page always has a cover, and what a
   * template or a buyer supplies only changes what is drawn on it.
   */
  readonly envelope: EnvelopeConfig
  readonly tokens: ThemeTokens
  readonly cssVariables: Readonly<Record<string, string>>
  readonly definitionVersion: number
  /** True when the stored document was older than this deploy and was migrated on read. */
  readonly migrated: Readonly<Record<DocumentName, boolean>>
  readonly omittedBlocks: readonly OmittedBlock[]
  /**
   * Overrides keyed to block ids the DEFINITION does not contain, which is what
   * a block removed from a template leaves behind. Reported so it is visible;
   * never deleted, because the buyer wrote it.
   *
   * A section the buyer took out of their own composition is not this. The
   * template still has that block, so the content still has somewhere to go
   * back to: it is reported as `removedSections` instead.
   */
  readonly orphanedContent: readonly OrphanedContent[]
  /**
   * Template blocks the buyer's composition leaves off the page, by id.
   *
   * Their words are still stored and are untouched by every save, which is what
   * makes putting a section back the same thing as never having removed it.
   */
  readonly removedSections: readonly string[]
  /**
   * Ids the buyer's composition names that this template has no block for.
   *
   * Skipped rather than fatal, and reported rather than swept up. It is what a
   * template that lost a block leaves behind in a composition, and the
   * composition is not rewritten to hide it.
   */
  readonly unknownSections: readonly string[]
  /** Set when the buyer's theme override was rejected and the template theme was used. */
  readonly themeOverrideRejected: {
    readonly issues: readonly DocumentIssue[]
    readonly stored: unknown
  } | null
  /**
   * Set when the buyer's envelope override was rejected and the template's own
   * envelope was drawn instead. Degrade rather than fail, for the same reason a
   * theme override degrades: a cover is not somebody's words, and an invitation
   * that serves under a plainer envelope is a working invitation.
   */
  readonly envelopeOverrideRejected: {
    readonly issues: readonly DocumentIssue[]
    readonly stored: unknown
  } | null
}

export type ResolveOutcome<Block> =
  | { readonly ok: true; readonly page: ResolvedPage<Block> }
  | {
      readonly ok: false
      readonly document: DocumentName
      readonly reason: LoadFailureReason | 'no-renderable-blocks'
      readonly message: string
      readonly issues: readonly DocumentIssue[]
      readonly stored: unknown
    }

type DefinitionShape = {
  readonly version: number
  readonly blocks: readonly {
    readonly id: string
    readonly type: string
    readonly config: unknown
  }[]
  /**
   * Typed as unknown so a test can hand this resolver a genuinely different
   * version of the format without having to carry this format's envelope type
   * with it. It is validated here either way.
   */
  readonly envelope?: unknown
}

/**
 * Injected rather than imported so a test can resolve a real stored document
 * against a genuinely different version of the format. That is not a testing
 * nicety: the claim this format makes is about surviving a version change, and
 * a claim you cannot exercise is a comment.
 */
export type ResolveDependencies<D extends DefinitionShape> = {
  readonly definition: DocumentPipeline<D>
  readonly content: DocumentPipeline<EventContent>
  readonly theme: DocumentPipeline<ThemeDocument>
  readonly themeOverride: DocumentPipeline<ThemeOverrideDocument>
  readonly configSchemas: BlockConfigSchemas
}

export const DEFAULT_RESOLVE_DEPENDENCIES: ResolveDependencies<TemplateDefinition> = {
  definition: templateDefinitionPipeline,
  content: eventContentPipeline,
  theme: themePipeline,
  themeOverride: themeOverridePipeline,
  configSchemas: BLOCK_CONFIG_SCHEMAS,
}

export function resolveEventPage<D extends DefinitionShape = TemplateDefinition>(
  stored: StoredEventDocuments,
  dependencies: ResolveDependencies<D> = DEFAULT_RESOLVE_DEPENDENCIES as unknown as ResolveDependencies<D>
): ResolveOutcome<D['blocks'][number]> {
  const definition = dependencies.definition.load(stored.definition)
  if (!definition.ok) return asFailure('definition', definition)

  const theme = dependencies.theme.load(stored.theme)
  if (!theme.ok) return asFailure('theme', theme)

  const content = dependencies.content.load(stored.content)
  if (!content.ok) return asFailure('content', content)

  const themeOverride = dependencies.themeOverride.load(stored.themeOverride)
  const tokens = themeOverride.ok
    ? mergeThemeTokens(theme.document.tokens, themeOverride.document.tokens)
    : theme.document.tokens

  const composition = composeSections(definition.document.blocks, content.document.sections)

  const blocks: D['blocks'][number][] = []
  const omittedBlocks: OmittedBlock[] = []

  for (const block of composition.blocks) {
    const override = Object.hasOwn(content.document.blocks, block.id)
      ? content.document.blocks[block.id]
      : undefined

    if (override === undefined || Object.keys(override).length === 0) {
      blocks.push(block as D['blocks'][number])
      continue
    }

    const configSchema = Object.hasOwn(dependencies.configSchemas, block.type)
      ? dependencies.configSchemas[block.type]
      : undefined

    // Unreachable while the definition validated against the same schema map,
    // and handled anyway rather than thrown, because this is a request path.
    if (configSchema === undefined) {
      omittedBlocks.push({
        id: block.id,
        type: block.type,
        issues: [{ path: 'type', message: `unknown block type "${block.type}"` }],
        storedOverride: override,
      })
      continue
    }

    const merged = applyOverride(block.config, override)
    const parsed = configSchema.safeParse(merged)

    if (!parsed.success) {
      omittedBlocks.push({
        id: block.id,
        type: block.type,
        issues: toIssues(parsed.error),
        storedOverride: override,
      })
      continue
    }

    blocks.push({ id: block.id, type: block.type, config: parsed.data } as D['blocks'][number])
  }

  if (blocks.length === 0) {
    return {
      ok: false,
      document: 'content',
      reason: 'no-renderable-blocks',
      message:
        'nothing was left to draw, so there is no page to serve. Either every composed section ' +
        "was omitted, or the composition names no section this template has. The buyer's " +
        'content is untouched; see the stored value and repair it rather than rewriting the row.',
      issues: [
        ...omittedBlocks.flatMap((omitted) =>
          omitted.issues.map((issue) => ({
            path: `blocks.${omitted.id}.${issue.path}`,
            message: issue.message,
          }))
        ),
        ...composition.unknown.map((id) => ({
          path: `sections.${id}`,
          message: 'this template has no section with that id',
        })),
      ],
      stored: stored.content,
    }
  }

  const envelope = resolveEnvelope(definition.document.envelope, content.document.envelope)

  /*
   * Definition relative, and deliberately not composition relative. Content
   * keyed to a section the buyer removed is not orphaned: the template still
   * has that block, so the words have somewhere to go back to the moment the
   * section does.
   */
  const definitionIds = new Set(definition.document.blocks.map((block) => block.id))
  const orphanedContent: OrphanedContent[] = Object.entries(content.document.blocks)
    .filter(([id]) => !definitionIds.has(id))
    .map(([id, storedOverride]) => ({ id, storedOverride }))

  return {
    ok: true,
    page: {
      blocks,
      envelope: envelope.config,
      tokens,
      cssVariables: themeToCssVariables(tokens),
      definitionVersion: dependencies.definition.version,
      migrated: {
        definition: definition.migrated,
        theme: theme.migrated,
        content: content.migrated,
        'theme override': themeOverride.ok ? themeOverride.migrated : false,
      },
      omittedBlocks,
      orphanedContent,
      removedSections: composition.removed,
      unknownSections: composition.unknown,
      themeOverrideRejected: themeOverride.ok
        ? null
        : { issues: themeOverride.issues, stored: themeOverride.stored },
      envelopeOverrideRejected: envelope.rejected,
    },
  }
}

/**
 * The cover the page will draw: the template's envelope with the buyer's
 * override merged over it, or the universal one when neither says anything.
 *
 * There are three ways to arrive at the universal envelope and they are the
 * same code path, which is what stops it being a special case somebody forgets
 * to test: a definition with no `envelope` key, a definition whose envelope has
 * no fields set, and a buyer who cleared every field out of the guided form.
 *
 * A rejected override degrades to the template's envelope instead of failing
 * the page. That is the theme override rule, applied for the theme override
 * reason: it is not the buyer's words about their wedding, and an invitation
 * that still serves is worth more than a designed error page.
 */
function resolveEnvelope(
  stored: unknown,
  override: Record<string, unknown> | undefined
): {
  readonly config: EnvelopeConfig
  readonly rejected: { readonly issues: readonly DocumentIssue[]; readonly stored: unknown } | null
} {
  const fromTemplate = envelopeConfigSchema.safeParse(stored ?? UNIVERSAL_ENVELOPE)

  /*
   * Unreachable while the definition validated against this schema, and handled
   * rather than thrown, because this is a request path.
   */
  const base = fromTemplate.success ? fromTemplate.data : UNIVERSAL_ENVELOPE

  if (override === undefined || Object.keys(override).length === 0) {
    return { config: base, rejected: null }
  }

  const merged = envelopeConfigSchema.safeParse(applyOverride(base, override))
  if (!merged.success) {
    return { config: base, rejected: { issues: toIssues(merged.error), stored: override } }
  }

  return { config: merged.data, rejected: null }
}

/**
 * Top level key replace, with `null` meaning "clear this field".
 *
 * A buyer deleting the eyebrow line out of the guided form has to be able to
 * say so, and JSON has no way to spell "absent" inside an object that is being
 * merged. Clearing a required field is not special cased: it produces a missing
 * field error from the block schema, which is the right answer.
 */
export function applyOverride(base: unknown, override: Record<string, unknown>): unknown {
  const merged: Record<string, unknown> = isJsonObject(base) ? { ...base } : {}

  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete merged[key]
      continue
    }
    merged[key] = value
  }

  return merged
}

function asFailure(
  document: DocumentName,
  outcome: {
    reason: LoadFailureReason
    message: string
    issues: readonly DocumentIssue[]
    stored: unknown
  }
): ResolveOutcome<never> {
  return {
    ok: false,
    document,
    reason: outcome.reason,
    message: outcome.message,
    issues: outcome.issues,
    stored: outcome.stored,
  }
}
