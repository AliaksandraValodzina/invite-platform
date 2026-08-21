# The envelope

Two things in this repo are called an envelope, and they have nothing to do with
each other. `docs/replies.md` uses the word for the fixed columns on a reply,
attendance and party size, as against the questions. This file is about the
paper one a guest taps.

A guest's first sight of an invitation is a closed envelope. They tap it, it
goes, and the invitation is there.

The component is `src/components/envelope/envelope-cover.tsx`, the document is
`src/lib/template/envelope.ts`, and the browser proof is
`tests/e2e/envelope.spec.ts`. Start at `docs/template-format.md` for the
documents this reads, and `docs/blocks.md` for the token rule it obeys.

## The invitation is the page. The envelope is over it.

This is the whole design and every other decision follows from it.

The blocks are rendered whole, in the document, in their normal order. The
envelope is a `fixed` element painted on top of them. Nothing is behind a gate,
nothing is fetched on open, nothing is hidden from assistive technology, and
nothing is `inert`. The captain's constraint is the reason:

> A guest who cannot open the envelope must still be able to read the invitation
> and reply. An envelope that traps the content is worse than no envelope,
> because the guest came for the details and the RSVP.

So the cover has four independent ways of not being a trap, and each of them is
load bearing on its own:

1. **It opens with no JavaScript.** A checkbox, a label pointing at it, and
   `peer-checked:invisible`. There is no client component, no handler and no
   hydration to wait for. `:has()` would have made the markup neater and is
   deliberately not used: it shipped in Chrome 105 and Firefox 121, and a guest
   on an older phone would have found an envelope that could not be opened.
   `:checked` with a sibling combinator is as old as CSS2.
2. **It opens by keyboard, and by anything that operates a form control.** It is
   a real checkbox, not a div with a click handler.
3. **The invitation is in the accessibility tree the entire time.** A screen
   reader reaches the RSVP form whether or not the cover was ever opened. The
   cost of that is real and accepted: a sighted keyboard user tabbing past the
   open control moves focus onto the page underneath, which is not visible. That
   is the trade, and it is made in the direction of reachability.
4. **Without CSS it is a static block at the top of the document**, with the
   invitation directly below it, because `ThemeScope` renders the cover first.

`tests/e2e/envelope.spec.ts` turns scripting off, opens the cover, fills the
name field and runs the submit button through Playwright's actionability checks.
It does the same with motion reduced. "The form is in the DOM" is not the claim.

## It does not delay the details

No script, no font of its own, no image unless a document names one. The
envelope is drawn from theme tokens the page already carries, so the whole cost
of the cover is markup. `tests/e2e/guest-page.spec.ts` asserts the venue, the
date and the reply button are in the bytes the server sent, before anything has
been clicked.

## Three directions, three envelopes, no new artwork

The universal envelope is one flap, two folds and a wax seal, and every value in
it is a token:

| Part                         | Token                                            |
| ---------------------------- | ------------------------------------------------ |
| the page it sits on          | `color.bg`                                       |
| the paper                    | `color.surface`                                  |
| the folds and the paper edge | `color.inkMuted`, at the browser hairline        |
| the corner                   | `radius.md`                                      |
| the seal                     | `color.accent`, with its initials in `accentInk` |
| the seal's size              | `space.xl`                                       |
| the note and the prompt      | `typeScale.caption`, `color.inkMuted`            |
| the names                    | `typeScale.display`                              |

Deckle & Deboss draws it in warm cream with a burgundy seal, Masthead in near
white with cobalt, Foil & Midnight in midnight blue with brass. The e2e spec
reads those values off the rendered page and holds them to the committed theme
documents, then asserts the three are distinct.

The geometry is an SVG, because a flap is a diagonal and CSS has no honest way to
draw one. It carries no colour and no length: the coordinates are viewBox units
and the paint is `currentColor`, which is the same contract `icons.tsx` has.

`tests/unit/components/block-tokens.test.ts` reads this directory as well as
`src/components/blocks/`. The envelope is not a block and it obeys the block
rule, because the reason for the rule applies to it exactly: one component has
to produce a different envelope in every direction, and a hex value inside it is
a direction that cannot have its own.

## What the document carries, and what it does not

```jsonc
// templates.definition, beside "blocks" and not inside it
"envelope": { "note": "You're invited", "openLabel": "Tap to open" }

// event_content.content, beside "blocks" for the same reason
"envelope": {
  "note": null,
  "image": {
    "src": "/a/9f2c1ab40d3e7856bb91c204-w800.webp",
    "widths": [
      { "src": "/a/9f2c1ab40d3e7856bb91c204-w800.webp", "width": 800 },
      { "src": "/a/41d8e7b0c9a3251f6e0d4487-w1600.webp", "width": 1600 }
    ]
  }
}
```

Every field is optional, and that is what makes the universal envelope a real
document rather than a branch in a component. Three routes arrive at it and they
are one code path: a definition written before the envelope existed, a
definition with an empty envelope, and a buyer who cleared every field out of
the guided form.

**There is no headline.** The cover shows the invitation's own, read off the
resolved hero exactly the way the share card reads its kicker
(`src/lib/og/event.ts`). Storing it here would be a second copy of the couple's
names, in a second field of the guided form, that can disagree with the first
one. The seal's initials are derived from the same string, so they cannot
disagree either.

**There is no `enabled` flag.** An invitation arrives in an envelope. If a
template ever needs to refuse one, that is a new optional field, which by
`docs/template-format.md` is a version bump with no rewrite.

**It is not a block.** A block is a section of the invitation, drawn in the
reading column, in the order the definition lists it. This is drawn over the
whole page and belongs to none of it. Adding it as a sixth block type would have
bought the content override machinery and paid for it with a lie in the format:
a block whose position in the list means nothing.

The envelope override degrades rather than fails. A stored override that does
not validate falls back to the template's envelope, reports itself as
`envelopeOverrideRejected`, and the invitation serves. That is the theme
override rule, applied for the theme override reason: the cover is not the
invitation.

## The buyer's own envelope, wired to the upload capability

`envelope.image` is where a buyer's own envelope picture goes, and as of this
change it is an integration rather than a seam. Uploads landed on `main` first,
so there was a real capability to consume and no reason to leave the field
inert.

The whole path, with nothing invented at either end:

1. The buyer sends the file to `POST /api/uploads` with `kind=envelope`. That is
   the one upload endpoint, and there is deliberately no second one here: this is
   the third use of one capability, not a fourth feature. `docs/uploads.md`.
2. The capability sniffs the format, refuses what it does not accept, re-encodes
   to the widths `UPLOAD_KIND_SPECS.envelope` names, stores each at the sha256 of
   its own bytes, and enforces one envelope per event in the database rather than
   in a route.
3. `pictureFromUpload` (`src/lib/uploads/picture.ts`) turns the stored
   variants into exactly this `image` object. It is the only place that knows
   both shapes, and `tests/unit/uploads/picture.test.ts` parses what it returns
   with `envelopeConfigSchema`, so the two halves cannot drift apart in silence.
4. `EnvelopeCover` draws it, resolving each `/a/<key>` through `resolveAssetSrc`
   at render time.

**It names keys, never URLs.** A stored document outlives the deployment that
wrote it, so a hostname inside one is a hostname that goes wrong. `/a/<key>` is
what is stored; the asset hostname is applied when the page renders. That is the
whole reason changing object storage vendor stays a DNS change instead of a
rewrite of every buyer's document, and `src/lib/uploads/host.ts` is where the
argument lives.

**It names every stored width.** The envelope kind is re-encoded to 800 and 1600
CSS pixels, each of which is a separate content address, so neither can be
derived from the other and both have to be written down. A content shape that
could hold only one would leave the other stored, counted against the event's
50 MB variant budget, and never sent to anybody. `src` is the SMALLEST of them,
because `src` is what a browser too old to read `srcset` fetches and that
browser is on the slowest phone in the room.

There is deliberately no `sizes` attribute. Writing one means writing a CSS
length inside a component, which the block token rule forbids and
`tests/unit/components/block-tokens.test.ts` fails on. The default it would
replace is `100vw`, which is very nearly true on a phone, because the picture is
full width inside the cover's padding, and the phone is the device the widths
exist for.

**What is still not built is the guided form.** There is no buyer editing
surface in Phase 0, so nothing in the product yet performs step 1 on a buyer's
behalf. That is an interface that does not exist, not a seam: every layer under
it is the shipping one, and `tests/e2e/envelope.spec.ts` walks the whole chain
over HTTP, from bytes posted as a signed in buyer to a picture a guest's browser
chose off the `srcset` and decoded.

The field still accepts an https URL and a bundled sample path, under the same
`imageSourceSchema` rules `hero.artwork` follows: a leading slash, a closed
extension list, no `svg`, no `..`, no `//`. `resolveAssetSrc` leaves both alone,
because a hostname somebody typed is already somebody's decision.

**It replaces the drawn envelope, not the background.** That is the decision
worth defending, and it is why the second reference the captain supplied, which
is a patterned cover with its own background, is not what this builds. A picture
behind the cover's words would be the one place on a guest page where text is
read against an image, and this repo's rule is that a contrast pairing has to be
measurable: `tests/unit/template/contrast.test.ts` can measure ink on `bg` and
it cannot measure ink on somebody's JPEG. The cover's background is the theme's
own `color.bg`, which is a background of its own, and it is one every direction
already has an answer for.

Like `hero.artwork`, the image has no alt key at all and is drawn with `alt=""`
and `aria-hidden`. Nobody should ever be asked to transcribe words baked into a
picture.

## Motion

A 300ms fade of opacity and visibility, and the end state is a plain
`invisible; opacity: 0` that does not depend on the transition running or
finishing. Under `prefers-reduced-motion` the transition is dropped and the
cover simply goes. The captain's note said static is fine, so nothing here is
load bearing, and there is no open animation to fail.

One consequence to know about: an opened cover stays in the layout at
`visibility: hidden`, so it still has a full viewport box. It is not painted, it
is out of the accessibility tree and it does not receive pointer events, but a
test that walks geometry has to filter on `visibility` rather than on box size.
`tests/e2e/blocks.spec.ts` does.

## The preview

`/preview/<theme>` starts the cover **open**, because that route exists to look
at the block set and a cover over all of it would mean every look at a block
started with a tap. `?envelope=closed` is how the envelope itself is looked at,
and `?fixture=universal-envelope` is a real content override that clears every
field, which is the same document a template with no envelope produces. Both are
linked from `/preview`.
