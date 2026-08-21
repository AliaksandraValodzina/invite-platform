/**
 * The envelope: the closed cover a guest sees first, drawn over the invitation.
 *
 * The single most important thing about this component is what it is NOT. It is
 * not a gate, and the invitation does not live behind it. The page is rendered
 * whole, in the document, in its normal order, and this is a `fixed` element
 * painted on top of it. Everything below follows from that.
 *
 * ## It opens with no JavaScript at all
 *
 * A checkbox and a label. The input is the `peer`, the cover is its next
 * sibling, and `peer-checked:invisible` is the whole mechanism. There is no
 * client component here, no event handler, no hydration to wait for and nothing
 * to fail: a browser with scripting turned off, or one where our bundle never
 * arrived, opens the envelope on the first tap exactly like every other browser.
 *
 * The selector is `:checked` plus a sibling combinator, which is as old as CSS2.
 * `:has()` would have allowed neater markup and was deliberately not used: it
 * shipped in Chrome 105 and Firefox 121, and a guest on an older phone would
 * have found an envelope that could not be opened, which is the exact failure
 * this feature must not have.
 *
 * ## And it cannot trap the page even if the cover itself fails
 *
 * Three independent reasons, because "the guest came for the details and the
 * RSVP" is the requirement and one mechanism is not enough for it:
 *
 *   1. The cover is `position: fixed`. If the stylesheet never arrives, it is a
 *      static block at the top of the document and the invitation is directly
 *      below it.
 *   2. The invitation is in the DOM and in the accessibility tree the whole
 *      time. A screen reader reaches the RSVP form whether or not the cover was
 *      ever opened, and nothing here is `inert` or `aria-hidden`, because both
 *      would need the thing they hide to be un-hidden by something, and that
 *      something would be JavaScript.
 *   3. The open state is a checkbox, so it is also reachable by keyboard alone
 *      and by assistive technology that activates form controls directly.
 *
 * ## And it does not delay anything
 *
 * No script, no font of its own, no image unless a template names one. The
 * envelope is drawn from theme tokens, which the page already carries, so the
 * cost of the cover is markup. The invitation underneath renders and lays out
 * on exactly the same schedule it did before this existed.
 *
 * ## Motion
 *
 * A 300ms fade, and the end state is a plain `invisible; opacity: 0` that does
 * not depend on the transition running or finishing. Under
 * `prefers-reduced-motion` the transition is dropped and the cover simply goes.
 * The captain's note said static is fine, so nothing here is load bearing.
 */

import { Fragment } from 'react'

import type { EnvelopeConfig, TemplateBlock } from '@/lib/template'
/*
 * `./host` directly rather than the `@/lib/uploads` barrel: that barrel also
 * re-exports the encoder, which imports sharp, and a page component has no
 * business pulling an image pipeline into its module graph to name a file.
 */
import { readAssetHostConfig, resolveAssetSrc } from '@/lib/uploads/host'

import { stackNames } from '../blocks/hero-block'

/**
 * The one piece of copy the block set owns here.
 *
 * `note` deliberately has no fallback: it is decoration, so a buyer clearing it
 * out of the guided form has to be able to make it go away. The prompt is not
 * decoration. A cover with nothing on it that says it opens is a cover a guest
 * does not know to tap, so the component always has one, whatever the document
 * says.
 */
export const DEFAULT_OPEN_LABEL = 'Tap to open'

/**
 * One id, because there is exactly one envelope on a page. It is a constant
 * rather than `useId` so that this stays a server component with no client
 * boundary, and so a test can name it.
 */
const OPEN_INPUT_ID = 'envelope-open'

/**
 * The cover's headline, read off the resolved hero rather than stored a second
 * time.
 *
 * Same decision, for the same reason, as `ogCardFields` reading the share
 * card's kicker off the blocks: the couple's names are one piece of content
 * that the buyer types once. A template that has no hero simply has no names on
 * its cover.
 */
export function envelopeHeadline(blocks: readonly TemplateBlock[]): string | undefined {
  const hero = blocks.find((block) => block.type === 'hero')
  return hero?.type === 'hero' ? hero.config.headline : undefined
}

/**
 * The letters pressed into the wax seal.
 *
 * Derived, never stored. It reuses the hero's own lockup split so that the two
 * agree about where a headline breaks into names, and it takes the first and
 * last of them: "Sarah & Tom" gives ST, "Emma" gives E, and a headline that is
 * a phrase rather than a pair gives its first letter.
 */
export function sealInitials(headline: string | undefined): string {
  if (headline === undefined) return ''

  const lines = stackNames(headline)
  const names = lines.length === 3 ? [lines[0], lines[2]] : [lines[0]]

  return names
    .map((name) => firstLetter(name ?? ''))
    .join('')
    .slice(0, 2)
}

function firstLetter(name: string): string {
  // Spread rather than charAt so a name starting outside the basic plane keeps
  // its whole character instead of half a surrogate pair.
  const first = [...name.trim()][0] ?? ''
  return first.toLocaleUpperCase()
}

export function EnvelopeCover({
  config,
  headline,
  startsOpen = false,
}: {
  readonly config: EnvelopeConfig
  /** The invitation's own headline. Absent when the template has no hero. */
  readonly headline?: string | undefined
  /** Preview affordance only. A guest page always starts closed. */
  readonly startsOpen?: boolean
}) {
  const openLabel = config.openLabel ?? DEFAULT_OPEN_LABEL
  const lines = headline === undefined ? [] : stackNames(headline)

  return (
    <div data-envelope="">
      {/*
       * The state, and the only stateful thing on the page. `sr-only` rather
       * than `hidden`, because a hidden input is not focusable and this control
       * has to be reachable by keyboard.
       */}
      <input
        id={OPEN_INPUT_ID}
        data-testid="envelope-open"
        type="checkbox"
        defaultChecked={startsOpen}
        className="peer sr-only"
      />

      <div
        data-envelope-cover=""
        data-envelope-drawn-from={config.image === undefined ? 'tokens' : 'image'}
        /*
         * `justify-center-safe` rather than `justify-center`: a centred flex
         * item taller than its container overflows in both directions and the
         * top of it cannot be scrolled to. Safe alignment falls back to the
         * start, which is what keeps a long name legible on a short phone.
         *
         * The focus outline is on the cover because the input it belongs to is
         * visually hidden, and it is drawn in `currentColor`, which is the
         * page's own ink. That is the same decision as the rest of the block
         * set: no focus colour is invented, because there is no focus token.
         */
        className="fixed inset-0 z-10 flex flex-col items-center justify-center-safe gap-[var(--space-md)] overflow-y-auto overscroll-contain bg-[var(--color-bg)] px-[var(--space-md)] py-[var(--space-lg)] text-center transition-[opacity,visibility] duration-300 peer-checked:invisible peer-checked:opacity-0 peer-focus-visible:outline motion-reduce:transition-none"
      >
        {config.note !== undefined && (
          <p data-envelope-note="" className="type-caption text-[color:var(--color-ink-muted)]">
            {config.note}
          </p>
        )}

        {lines.length > 0 && (
          /*
           * A paragraph and not a heading. The page's one `h1` is the hero's,
           * underneath, and a cover that added a second one would leave a guest
           * using a screen reader with two competing titles for one invitation.
           * The lockup is the hero's own, so the names break in the same place
           * on the cover as they do on the page.
           */
          <p data-envelope-headline="" className="type-display text-balance break-words">
            {lines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 && ' '}
                <span className="block">{line}</span>
              </Fragment>
            ))}
          </p>
        )}

        {config.image === undefined ? (
          <EnvelopeDrawing initials={sealInitials(headline)} />
        ) : (
          <EnvelopePicture image={config.image} />
        )}

        {/*
         * Announced once, not twice. This is the visible half of the label
         * below, which carries the same words for assistive technology, so this
         * copy is hidden from it rather than read out a second time.
         */}
        <p
          data-envelope-prompt=""
          aria-hidden="true"
          className="type-caption text-[color:var(--color-ink-muted)]"
        >
          {openLabel}
        </p>

        {/*
         * The whole cover is the target. The references the captain supplied
         * both say "click to open" about the page rather than about a button,
         * and a guest holding a phone one handed should not have to find a
         * 40px control.
         */}
        <label htmlFor={OPEN_INPUT_ID} className="absolute inset-0 cursor-pointer">
          <span className="sr-only">{openLabel}</span>
        </label>
      </div>
    </div>
  )
}

/**
 * The universal envelope: one flap, two folds and a seal, and every value in it
 * is a token.
 *
 * This is what "matches any theme" means in practice. The paper is `surface`,
 * the folds are `inkMuted` at the browser hairline, the seal is `accent` with
 * its label in `accentInk`, the corner is `radius.md` and the seal is one
 * `space.xl` across. Deckle & Deboss draws it in warm cream with a burgundy
 * seal, Masthead in near white with its own accent, and Foil & Midnight in
 * midnight blue with brass, from this one component and no new artwork.
 *
 * The geometry is an SVG because a flap is a diagonal and CSS has no honest way
 * to draw one. It carries no colour and no length: the coordinates are viewBox
 * units, the paint is `currentColor` inherited from the wrapper's text colour,
 * and the stroke is the same hairline the form controls use.
 */
function EnvelopeDrawing({ initials }: { readonly initials: string }) {
  return (
    <div
      data-envelope-drawing=""
      className="relative flex aspect-3/2 w-full max-w-xs items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-ink-muted)] bg-[var(--color-surface)] text-[color:var(--color-ink-muted)]"
    >
      <svg
        viewBox="0 0 300 200"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 h-full w-full"
      >
        {/* The flap, and the two folds that run up to it from the bottom corners. */}
        <path
          d="M0 0 L150 112 L300 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 200 L112 106 M300 200 L188 106"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span
        data-envelope-seal=""
        data-envelope-initials={initials}
        className="type-caption relative flex size-[var(--space-xl)] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent)] text-[color:var(--color-accent-ink)]"
      >
        {initials}
      </span>
    </div>
  )
}

/**
 * A buyer's own envelope, in place of the drawn one.
 *
 * It replaces the envelope and not the background, which is the decision worth
 * defending. A picture behind the cover's words would be the one place on this
 * page where text is read against an image, and this repo's rule is that a
 * contrast pairing has to be measurable: `tests/unit/template/contrast.test.ts`
 * can measure ink on `bg`, and it cannot measure ink on somebody's JPEG.
 *
 * `alt=""` and `aria-hidden` for the same reason `hero.artwork` carries them.
 * It is decoration, the format gives it no alt key, and nobody should ever be
 * asked to transcribe words baked into a picture.
 *
 * A plain `img`, like the hero's two, because `next/image` wants a host
 * allowlist or stored dimensions and the format has neither yet. No lazy
 * loading and no low priority here: this one is the first thing on screen.
 *
 * ## What it does with what the buyer uploaded
 *
 * Two things, and both are the upload capability's rules rather than this
 * component's taste.
 *
 * **The hostname is applied here and is never stored.** Content names an
 * upload as `/a/<key>`, and `resolveAssetSrc` turns that into whatever hostname
 * this deployment serves assets from. With none configured it stays a same
 * origin path served by this app, which is not a degraded mode: it is how the
 * whole capability runs locally with no cloud credential.
 *
 * **Every stored width is offered.** An envelope upload is re-encoded to two
 * widths, they are separate content addresses, and `widths` names both. The
 * browser picks; a phone at 320 CSS pixels takes the small one and a laptop
 * takes the large one, from one document.
 *
 * There is deliberately no `sizes` attribute. Writing one means writing a CSS
 * length in a component, which the block token rule forbids and the guard in
 * `tests/unit/components/block-tokens.test.ts` fails on, and the default it
 * would replace is `100vw`. On a phone that is very nearly true, because the
 * picture is full width inside the cover's padding, and the phone is the device
 * the widths exist for. On a wide screen it over-estimates and the browser
 * fetches the large file for a picture drawn small, which costs a laptop on
 * wifi something a phone on hotel wifi would not have been able to afford.
 */
function EnvelopePicture({ image }: { readonly image: EnvelopePictureContent }) {
  const host = readAssetHostConfig()
  const srcSet = image.widths
    ?.map((candidate) => `${resolveAssetSrc(candidate.src, host)} ${candidate.width}w`)
    .join(', ')

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-envelope-picture=""
      src={resolveAssetSrc(image.src, host)}
      {...(srcSet === undefined ? {} : { srcSet })}
      alt=""
      aria-hidden="true"
      decoding="async"
      className="block w-full max-w-xs rounded-[var(--radius-md)]"
    />
  )
}

/** The `image` half of a resolved envelope, once it is known to be present. */
type EnvelopePictureContent = NonNullable<EnvelopeConfig['image']>
