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
 *   one block's override   omit that block, render the rest, report it. The
 *     invalid              only block that can ever be omitted is one whose
 *                          buyer content we cannot trust, and the template
 *                          default is not a stand-in for a buyer's words.
 *   every block omitted    fail. An empty page is not a page.
 *
 * Nothing is deleted or rewritten in any of those cases. Every rejected value
 * comes back in the outcome, verbatim, so it can be logged and repaired.
 */

import { BLOCK_CONFIG_SCHEMAS } from './blocks'
import { eventContentPipeline, type EventContent } from './content'
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
  readonly tokens: ThemeTokens
  readonly cssVariables: Readonly<Record<string, string>>
  readonly definitionVersion: number
  /** True when the stored document was older than this deploy and was migrated on read. */
  readonly migrated: Readonly<Record<DocumentName, boolean>>
  readonly omittedBlocks: readonly OmittedBlock[]
  /**
   * Overrides keyed to block ids the definition no longer contains, which is
   * what a removed block leaves behind. Reported so a removal is visible;
   * never deleted, because the buyer wrote it.
   */
  readonly orphanedContent: readonly OrphanedContent[]
  /** Set when the buyer's theme override was rejected and the template theme was used. */
  readonly themeOverrideRejected: {
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

  const blocks: D['blocks'][number][] = []
  const omittedBlocks: OmittedBlock[] = []
  const usedContentIds = new Set<string>()

  for (const block of definition.document.blocks) {
    const override = Object.hasOwn(content.document.blocks, block.id)
      ? content.document.blocks[block.id]
      : undefined

    if (override !== undefined) usedContentIds.add(block.id)

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
        'every block was omitted, so there is no page to serve. The buyer content is untouched; ' +
        'see the stored value and repair it rather than rewriting the row.',
      issues: omittedBlocks.flatMap((omitted) =>
        omitted.issues.map((issue) => ({
          path: `blocks.${omitted.id}.${issue.path}`,
          message: issue.message,
        }))
      ),
      stored: stored.content,
    }
  }

  const orphanedContent: OrphanedContent[] = Object.entries(content.document.blocks)
    .filter(([id]) => !usedContentIds.has(id))
    .map(([id, storedOverride]) => ({ id, storedOverride }))

  return {
    ok: true,
    page: {
      blocks,
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
      themeOverrideRejected: themeOverride.ok
        ? null
        : { issues: themeOverride.issues, stored: themeOverride.stored },
    },
  }
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
