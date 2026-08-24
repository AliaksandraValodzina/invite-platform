# Composition

Stage 7, second half. A buyer decides **which sections their invitation has, in
what order, and in what colours**.

`docs/editing.md` shipped the first half, filling in the fields a template's
sections already have, and deliberately excluded this. Start there, and at
`docs/template-format.md`, because everything below is downstream of both.

The code is `src/lib/template/composition.ts` (the format), `src/lib/editor/
composition.ts` and `src/lib/editor/palette.ts` (pure), `src/components/editor/
composition-panel.tsx` and `palette-fields.tsx` (the controls), and the two new
actions in `src/app/dashboard/[id]/edit/actions.ts`.

## What is in scope, and what is not

**In.** Moving a section up or down, taking one out, putting one back, and
choosing the eight colours the whole page is drawn from.

**Out, and it is the other half of the other half.** A catalogue with more than
one design per section type, so that "choose a countdown design" means something.
Each design is authoring work, and how many there can be is set by a pipeline
nobody has decided on: the open captain decision is
`ip-product-plan-decision-art-sourcing-and-capacity`. Building a picker before
that decision would be building a promise the product cannot keep, so there is no
picker, and the panel says plainly that choosing a design is not available yet.

**What a buyer can therefore add is a section this template has that their
invitation currently leaves out.** That is a real answer rather than a
placeholder for one: the reason somebody reaches for "add a section" today is
that they took one out, and this is exactly the case that has to be free of
consequences.

## The section list is an override, like the words are

`event_content.content` gains an optional `sections`: block ids, in the order the
page draws them.

```jsonc
{ "version": 3, "blocks": { "hero": { ... } }, "sections": ["hero", "rsvp", "countdown"] }
```

**Absent means the template's own block list, in the template's order.** Every
event that existed before this renders exactly as it did the day before, and a
template that gains a section still reaches every buyer who has never composed.
That is the same promise `blocks` makes about a typo fix in a template's default
copy, applied one level up, and it is why the version 2 to 3 migration writes a
number and nothing else. Writing the template's order into every stored document
would have frozen every existing invitation at whatever its template said that
afternoon.

The same rule runs the other way on a save. A composition that ends up back at
the template's order is stored as **no list at all** rather than as an equivalent
one, so an invitation that has been moved and moved back goes back to tracking
its template. `tests/unit/editor/composition.test.ts` and
`tests/e2e/composition.spec.ts` both hold that.

### Ids, and nothing else

No `type` and no `config`. The id selects the template block, the block's `type`
selects the schema, and the buyer's words are still keyed by the id in `blocks`.
Keeping those three apart is what makes a rename survivable
(`docs/template-format.md`), and repeating `type` here would be a second answer
to "what kind of section is this" that could disagree with the first one.

It follows that this shape cannot name a section the template does not contain,
which is the catalogue above. Reaching it later is a version bump and a
migration on the content document, which is what the format is built for.

### An id the template no longer has

Skipped from the page, reported, never fatal. A template can genuinely lose a
block: a type is retired, an id is rewritten by a definition migration
(`docs/template-format.md`, "Removing a block"). An invitation that went dark
because of a change we made to a template is a failure the buyer cannot see the
cause of, let alone repair, so the rest of the page still serves and
`resolveEventPage` reports it as `unknownSections`.

The editor says so too, and says what will happen: the next composition change
writes a list built from this template, so the dead id stops being named. What
was written under it is untouched, because no save has ever touched
`content.blocks` for a section it is not editing.

## Removing a section keeps its words

**This is the decision the stage had to make rather than assume, and the answer
is preserve.**

Removal takes an id out of `sections` and touches `content.blocks` not at all.
Putting the section back is therefore the same thing as never having removed it:
the venue, the address and the note come back exactly as they were typed.

Why that way round. The stored document is the buyer's **only** copy of their own
words: there is no local draft, no undo history in the browser, and no way for
them to get a sentence back once it is gone. Set against that, the cost of
keeping is a few hundred bytes of JSON in a row that is already being written.
The two mistakes are not the same size. Somebody who removes a section by
accident, or who takes the map out for a week while the venue is being
confirmed, loses nothing; the alternative loses a paragraph to a mis-tap.

It is also already the rule one step out. Content keyed to a block the _template_
no longer has survives every save and is reported rather than deleted
(`docs/editing.md`), for the same reason and in the same words: "an editor that
tidied it up would be the only thing between a buyer and their words if that
block came back."

Two consequences worth stating:

- A removed section's stored override is **not** reported as `orphanedContent`.
  That name means the template has no block with that id at all, which is a
  worse thing: there is nowhere for those words to go back to. A removed section
  has somewhere. The resolver reports it as `removedSections` instead.
- `checkContent` stops validating a section the invitation no longer has. That is
  not an economy: without it, a buyer whose stored words for one section no longer
  fit the template would take that section off the page and then be unable to save
  anything at all, because the gate was still checking something nobody is being
  shown. It is checked again the moment the section comes back, which is the
  moment it starts mattering.

## What a guest sees mid-edit

**Never a half rearranged page.** Composition lives inside the content document,
so a composition change is the same write the words take: `public.save_event_content`
writes one whole new published revision inside one transaction, and a guest reads
the published revision or the one before it. There is no request in which a page
exists with half a reorder applied.

Every control is its own submit button carrying its own command (`up:hero`,
`remove:venue-map`), so one press is one complete saved order rather than an edit
somebody has to remember to commit. That is also why the panel needs no
JavaScript at all.

**There is still no draft state, and the panel says so rather than implying
otherwise.** On a live invitation each press is what guests see from that moment.
The honest answer to a buyer who would rather rearrange unwatched is the one that
already exists: take it down, rearrange, put it back up. Publish and unpublish
shipped with `docs/activation.md` and are at the bottom of the same page.

A draft that is edited over several sittings and published once is still not
built. It is a real feature and it is a different one: it needs a second published
flag, a preview address, and an answer to what happens when a draft and a live
revision disagree about a section that has since left the template.

### Removing a load bearing section asks first

Taking the venue and the address off an invitation twelve people have already
replied to is the same harm as changing them, expressed as a change to nothing.
So a removal that empties a load bearing detail (`src/lib/editor/load-bearing.ts`)
stops, shows how many people have replied, and asks. It is a confirmation and
never a block, and nothing is sent to guests either way.

Moving a section does not ask: the same facts in a different order are the same
facts. Putting one back does not ask either: it restores what guests could read
before and takes nothing away.

## The colours

`event_content.theme` has existed since the first migration and nothing wrote it
until now. A buyer picks seven colours and one choice, and the page is drawn from
the eight roles that come out.

### The guest page degrades, and nothing here changed that

`resolveEventPage` has always fallen back to the template's theme when a stored
override does not validate, and reported it rather than failing the page. That is
the safety net under all of this and it is deliberately untouched: an invitation
in the wrong palette still tells guests where to be, and one that refuses to
render does not. `tests/e2e/composition.spec.ts` seeds a palette this deploy
cannot read, straight into the column, and reads a working invitation in the
template's colours off the guest page.

What is tightened is the form, not the read path. Every colour is an
`<input type="color">`, so a browser hands back a hex. A value the save cannot
read is refused with the field named and nothing is written, which is a form
telling you which box is wrong rather than a page refusing to exist.

### `accentInk` is a choice, not a swatch

The token schema requires `accentInk` to be the same value as `bg` or `surface`,
because a label on an accent fill drawn in `ink` failed in all three design
directions at about 2:1 (`docs/design-directions.md`). An eighth swatch would
offer a value the schema then refuses, so the form offers the choice it actually
is: the page colour, or the card colour. The failing pairing is unreachable from
the form rather than merely unused.

### Contrast is reported, never enforced

The panel recomputes the same pairs the committed themes are asserted on
(`tests/unit/template/contrast.test.ts`) and prints every ratio with its floor.
It does not block a save. The palette is the buyer's, they may be choosing for a
reason we cannot see, and a product that argued with the person who paid for it
over a colour would be worse than one that tells them what their guests will
struggle with.

The pair that looks missing from that list is `border`, and its absence is
explained where the list is: every committed theme sets `border` as a decorative
hairline near 1:1, so holding it to the 3.0 a non text boundary needs would report
every design we sell as failing. What a guest must find is the outline of a reply
form field, and the block set draws that in `inkMuted` on `surface`, which is on
the list at the stricter text floor.

### A palette is a revision

`public.save_event_content` now takes the content and the theme, either of which
may be absent, and carries the absent one forward from the revision it is
replacing. So the words save leaves the palette alone, the palette save leaves the
words alone, and both write one complete new published revision. "Put it back the
way it was on Tuesday" is as real a request about a colour as it is about a
sentence, and a palette edited in place would be the one part of a buyer's page
with no history.

A palette identical to the template's is stored as no override at all, for the
reason the section list is: an event that has overridden nothing keeps tracking
its template.

## Tests

`tests/unit/template/composition.test.ts` for the format, over the committed
template. `tests/unit/editor/composition.test.ts` and
`tests/unit/editor/palette.test.ts` for the pure editor modules; the remove and
re-add claim is asserted there both on the document a save would write and
through the form the buyer would then be looking at, because words that are still
in the row but no longer in the form are words a buyer has lost.
`supabase/tests/10_save_event_content.test.sql` for the two halves of a save and
the section list constraint. `tests/e2e/composition.spec.ts` walks all of it in a
browser, and every assertion reads the page a **guest** gets: not that a control
is absent, but that the page reads hero, then countdown, then the reply form.
