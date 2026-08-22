import 'server-only'

import { z } from 'zod'

import { TEMPLATE_PREVIEW_REVALIDATE_SECONDS } from '@/lib/serving/cache'
import {
  EMPTY_EVENT_CONTENT,
  EMPTY_THEME_OVERRIDE,
  type StoredEventDocuments,
} from '@/lib/template'

import { serviceGet } from './service'

/**
 * The public template read, behind `/t/<templateId>`.
 *
 * The service role, for the reason `20260819010300_templates.sql` gives at the
 * bottom of itself: "There is no 'any authenticated user can read published
 * templates' policy yet. Buyers reach the catalogue through an API route with
 * the service role, same as guests reach event pages." This is that route, and
 * a preview of an unpublished template is a design nobody has decided to sell
 * yet, so `status=eq.published` is the whole of the access rule.
 *
 * What comes back is only `definition` and `theme`. No `owner_id`, no `key`, no
 * timestamps: a public page has no use for them, and the read that names only
 * what it renders cannot leak what it did not.
 *
 * ## This is not the claim link
 *
 * A preview creates nothing and copies nothing, which is what lets it be handed
 * to anybody. That separation is the point: an open "use this template" link
 * would turn one sale into unlimited invitations, because here the invitation
 * is the purchase rather than a feature of a subscription somebody keeps paying
 * for. See docs/activation.md.
 */

/** Matches the uuid `templates.id` holds, so a junk path costs no query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPossibleTemplateId(value: string): boolean {
  return UUID.test(value)
}

export type TemplatePreviewOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'found'
      readonly name: string
      /** Definition and theme, with no buyer content and no theme override. */
      readonly documents: StoredEventDocuments
    }

const rowSchema = z.object({
  name: z.string(),
  definition: z.unknown(),
  theme: z.unknown(),
})

export function templatePreviewCacheTag(templateId: string): string {
  return `template:${templateId}`
}

export async function loadTemplatePreview(templateId: string): Promise<TemplatePreviewOutcome> {
  if (!isPossibleTemplateId(templateId)) return { kind: 'not-found' }

  let response
  try {
    response = await serviceGet(
      `templates?${new URLSearchParams({
        id: `eq.${templateId}`,
        status: 'eq.published',
        select: 'name,definition,theme',
        limit: '1',
      }).toString()}`,
      {
        revalidate: TEMPLATE_PREVIEW_REVALIDATE_SECONDS,
        tags: [templatePreviewCacheTag(templateId)],
      }
    )
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : 'the database could not be reached',
    }
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }
  if (!Array.isArray(response.json) || response.json.length === 0) return { kind: 'not-found' }

  const parsed = rowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'the template row was not the shape this deploy expects' }
  }

  return {
    kind: 'found',
    name: parsed.data.name,
    documents: {
      definition: parsed.data.definition,
      theme: parsed.data.theme,
      /*
       * Empty documents rather than null. A preview is the template as it
       * ships, so there is nothing of anybody's to merge over it, but
       * `resolveEventPage` reads content through the same pipeline it uses for
       * a real event and refuses a null: content is a document, and "no
       * document" and "a document with no overrides in it" are different
       * things everywhere else in the format.
       */
      content: EMPTY_EVENT_CONTENT,
      themeOverride: EMPTY_THEME_OVERRIDE,
    },
  }
}

/**
 * The definition and theme behind one event, read with the service role.
 *
 * The editor needs this and cannot get it as the buyer, and the reason is a
 * real one rather than an oversight. `templates` has one policy,
 * `owner_id = auth.uid()`, and a buyer does not own the template they
 * activated: the seller does. `20260819010300_templates.sql` says as much and
 * defers the question ("When a real catalogue exists it gets a policy written
 * against that requirement rather than a guess at it now").
 *
 * So the split is: which event this is stays a row level security decision, and
 * only the design document is read this way. The caller has already loaded the
 * event through the buyer's own token, so `templateId` is an id the database
 * handed that buyer; this returns two JSON documents and nothing else, with no
 * owner, no key and nothing of anybody's. A bug here can show a buyer the wrong
 * design. It cannot show them another buyer's wedding, which is what the rule
 * in `src/lib/supabase/editing.ts` exists to guarantee.
 *
 * The alternative is a select policy on `templates` for `authenticated`, which
 * is a better long term answer and a schema change. It is written up in
 * docs/activation.md rather than taken here.
 */
export async function loadTemplateDocuments(
  templateId: string
): Promise<{ readonly definition: unknown; readonly theme: unknown } | null> {
  if (!isPossibleTemplateId(templateId)) return null

  let response
  try {
    response = await serviceGet(
      `templates?${new URLSearchParams({
        id: `eq.${templateId}`,
        select: 'definition,theme',
        limit: '1',
      }).toString()}`,
      // Never cached. A buyer who is editing has to be editing the design that
      // is stored, not one a shared cache kept from somebody else's request.
      { revalidate: false }
    )
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = z
    .object({ definition: z.unknown(), theme: z.unknown() })
    .safeParse(response.json[0])

  return parsed.success ? { definition: parsed.data.definition, theme: parsed.data.theme } : null
}
