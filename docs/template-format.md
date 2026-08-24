# The template definition format

Phase 0.3. This is the product's file format. Blocks, the renderer, the OG card,
and eventually the guided form and anything resembling a marketplace all inherit
its shape, and it is the thing that is most expensive to change once real events
exist in production.

Code is in `src/lib/template/`. Seed files are in `templates/`. Nothing in that
directory renders anything: the block set that does is `docs/blocks.md`, and the
guided form that writes content is `docs/editing.md`.

## Three documents, not one

| Document   | Column                                   | Holds                                                                          |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| definition | `templates.definition`                   | which blocks, in what order, default copy, and the envelope                    |
| theme      | `templates.theme`, `event_content.theme` | tokens, and only tokens                                                        |
| content    | `event_content.content`                  | the buyer's overrides, keyed by block id, their section list, and the envelope |

```jsonc
// definition, at version 5 since every picture in it became one shape
{ "version": 5, "envelope": { ... }, "blocks": [{ "id": "hero", "type": "hero", "config": { ... } }] }

// theme, at version 2 since the type scale gained a font per role
{ "version": 2, "tokens": { "color": {...}, "font": {...}, "typeScale": {...}, "space": {...}, "radius": {...} } }

// content, at version 3 since it gained the buyer's own section list
{ "version": 3, "blocks": { "hero": { "headline": "Priya & Alex" } }, "sections": ["hero", "rsvp"], "envelope": { ... } }
```

`envelope` is beside `blocks` in both documents and not inside either, because
the cover is drawn over the page rather than being a section of it, and it has
no block id to be keyed by. `docs/envelope.md` has the whole of it.

`sections` is the buyer's composition: block ids, in the order the page draws
them. It is **absent** until they move something, and absent means the
definition's own block list in the definition's own order, which is what keeps a
section added to a template reaching every event that never composed.
`docs/composition.md` has the whole of it.

Each carries its own `version` and each versions independently. Adding a colour
role is not the same change as adding a block, and forcing them to share a
number would mean every restyle invalidated every stored definition.

## Two identifiers doing two different jobs

This is the single most load bearing decision in the file format, and it is one
line of schema.

- **`id` is the identity of a block instance.** Event content is stored keyed by
  it. An id is permanent and is never reused for a different block.
- **`type` is the identity of a block kind.** It selects the config schema, and
  later the component.

Because content is keyed by `id` and never by `type`, renaming a block type
moves no buyer content. Because ids are never reused, a removed block leaves an
orphan that can be found rather than a key that silently belongs to something
else now.

It is also what made composition cheap. `content.sections` is a list of ids and
carries no `type` and no `config`, so a buyer's own section order is a
permutation of a list that already exists rather than a second copy of it.

## Content overrides, not snapshots

`event_content.content` holds only what the buyer changed. A block they never
touched has no entry at all, so fixing a typo in a template's default copy
reaches every event that did not override it. Snapshotting the whole page at
activation would make that typo permanent for everyone who bought before we
noticed.

An override is a shallow, strict partial of the block config, and merging is a
**top level key replace**. A nested object such as `hero.image` or
`rsvp-form.guestCount` is supplied whole or not at all. That is a deliberate refusal
to write a deep merge: deep merging arrays and optional keys has a dozen
defensible answers and the wrong one silently produces a page nobody asked for.
The merged result is then validated against the full block schema, so a half
supplied nested object fails immediately.

`null` in an override means "clear this field", because a buyer deleting the
eyebrow line out of the guided form has to be able to say so. Clearing a
required field is not special cased: it produces a missing field error.

## Theme tokens

Colour tokens are **roles**: `bg`, `surface`, `ink`, `inkMuted`, `accent`,
`accentInk`, `border`, `critical`. A token named after where it is used, say
`buttonPink`, cannot be re-themed, because the name has already decided where it
is allowed to appear.

`accentInk` exists so a block never has to guess that text on `accent` is white.
`critical` exists so RSVP validation errors are not the one place a block
reaches for a hardcoded red. The role list is closed: if a block needs a colour
that is not in it, the fix is a new role here, never a literal in the block.

One relationship between roles is enforced rather than described: `accentInk` has
to be the same value as `bg` or `surface`. `ink` on an `accent` fill measures
1.81, 2.10 and 1.73 to one in the three design directions, and `accentInk` is the
only colour the block set draws on an accent fill, so pinning it is what makes
that pairing unrepresentable rather than merely undrawn. See
`docs/design-directions.md`.

A type step also carries `font`, naming which of the two stacks the role is set
in. That arrived in theme version 2, because one direction needs its section
headings in its body face while its names stay in its display face, and the block
set used to decide that for every theme at once in a stylesheet.

Values are constrained harder than they look. Colours are hex only and opaque,
font stacks may not contain semicolons, braces or parentheses, and every URL
anywhere in the format must be `https`. These are all written into a page a
stranger opens from a group chat, and a token that can hold an arbitrary CSS
expression is a way to put arbitrary CSS on a guest page.

The one thing that is not a URL is a picture the app serves itself. That is a
leading slash path with a closed extension list, and it rejects a leading `//`,
which a browser reads as another host, a `..` segment, and `svg`, because an SVG
is a scriptable document and one from our own origin is same origin with the
guest page.

Alpha is refused for a second reason on top of that one: a contrast ratio against
a translucent colour is not computable without knowing every layer behind it, so
a token that carries alpha is a token whose legibility cannot be asserted.

`themeToCssVariables` is the only bridge from a token to a stylesheet. Blocks
read those custom properties and nothing else, which is what makes "no hardcoded
colour, font, radius or spacing value inside a block" a rule that can be
followed rather than a rule that gets apologised for.

## Metadata for the guided form

Some schemas carry `.meta({ control: ... })`, and nothing in the format itself
reads it. It is what `src/lib/editor/fields.ts` uses to pick a control that
structure alone cannot pick: `httpsUrlSchema` and a headline are both bounded
strings, and a picture is one thing a buyer swaps rather than an address and a
list of widths. Text schemas may also carry a label, as a Zod description.

Both live on the schema so they travel with the format rather than in a table
beside it, and both are optional: a field nobody labelled still gets a form, and
a field with no `control` is drawn from its shape. See `docs/editing.md`.

## The five v1 blocks

`hero`, `details`, `countdown`, `map`, `rsvp-form`. Five, and no more.

Two rules cut across all of them:

**Config is content.** No colour, font, radius or spacing value appears in a
block config, because those are tokens.

**Nothing duplicates the event row.** The date, the time and the time zone live
on `events` and are the source of truth for the countdown. A block config
carrying a date would be a second answer to "when is the wedding", and the time
zone correctness rule would stop being enforceable in one place. Where a details
item needs the date it writes `"source": "event-date"` instead, from a closed
enum. There is deliberately no expression language: `{{event.date}}` in a buyer
editable document is how a template becomes a sandbox.

### Pictures: one shape, two kinds

Every picture in the format is `{ src, widths? }`, built by one of two factories
in `primitives.ts`, and the pair differ by exactly one thing:

| Factory             | Is         | Alt text         | Where it is used                            |
| ------------------- | ---------- | ---------------- | ------------------------------------------- |
| `contentPicture`    | content    | required         | `hero.image`, a photo in the reading column |
| `decorativePicture` | decoration | none, and no key | `hero.artwork`, `envelope.image`            |

`src` is the SMALLEST stored width, because it is what a browser too old to read
`srcset` fetches and that browser is on the slowest phone in the room. `widths`
names every stored width, because an upload is re-encoded to more than one and a
shape that could name only one of them would leave the rest stored, counted
against the event's variant budget, and never served. Each width is a separate
content address, so they cannot be derived from one another.

A picture may be an https URL or an app served path, which is what an upload is
named by: `/a/<key>`, with no hostname, because the hostname is a property of the
deployment and is applied at render time. That was true of `artwork` and the
envelope from the start, and true of `hero.image` from version 5 (before it, the
one picture a buyer most wants to add from their phone was the one field the
upload capability could not fill).

Both factories tag the object with `.meta({ control: 'picture', uploadKind })`.
That is metadata for the guided form rather than validation, and it sits on the
object rather than on `src` because swapping a picture changes its address and
every width together. See `docs/editing.md`.

`artwork` is what makes the top of a page read as an invitation. It has no alt
key at all, and that absence is the design: the block draws it with `alt=""`, so
nobody is ever asked to transcribe words that are baked into a picture.

Which is the failure mode to watch. A whole invitation card used as artwork puts
the couple's names, date and venue on the page twice, once as pixels in somebody
else's typeface and once as the real themed text below, and it puts the wrong
wedding into a screen reader if it is described. The format cannot enforce that,
because it cannot read a JPEG. The guided form will have to, and until it exists
the artwork committed with a template is cropped to its artwork by hand. See
`public/samples/unlicensed-placeholder/README.md`.

There is no crop, focal point or frame key. The band is the shape of the file.
The stepped arch aperture the design directions report specifies is a `frame`
value that has not been built; by the rules below it arrives as a new optional
field, which is a version bump with no rewrite.

### The envelope is not a block

The cover a guest opens is `definition.envelope`, a sibling of the block list,
and a buyer's changes to it are `content.envelope`, merged by the same top level
key replace with the same `null` clearing. Every field is optional, so a
definition written before the envelope existed and a buyer who cleared every
field resolve to the same thing: the universal envelope, drawn from theme tokens.

It carries no headline. The cover shows the invitation's own, read off the
resolved hero. It carries an `image`, which is a buyer's uploaded envelope: an
`envelope` kind upload, named as `/a/<key>` for every width the capability
stored and never as a hostname. See `docs/envelope.md`.

### `rsvp-form` carries no questions

The rsvp-form config carries the words on the form and one envelope control,
`guestCount`, and nothing else. What an event asks is rows in `rsvp_questions`
(`docs/replies.md`), because every question carries the `pii_class` that decides
what the retention sweep erases.

That is both a scope control and a privacy control, and it is stronger than the
record of toggles it replaced in version 3. There is one answer to "what does
this event ask" rather than a document and a table that can disagree, and a
stored document cannot introduce a question, so it cannot introduce guest
personal information that nothing classified.

## How the format changes over time

A stored document carries its own `version`. On read, migrations are applied in
order from the stored version up to the current one, **in memory**, and only then
is the result validated against the current schema. Old documents are therefore
never invalid, they are just old.

```
stored v1  ->  migration 1->2  ->  migration 2->3  ->  validate against v3 schema
```

The ladder must be complete. `createDocumentPipeline` throws at import time if a
version has no way forward, so shipping version 3 with only a 1 to 2 migration is
a startup failure a unit test catches, not a runtime surprise a guest finds.

**Migration on read is never written back.** A guest page renders a migrated
document while the database still holds the original, until the buyer next saves.
That means a bad migration is fixed by deploying a fix rather than restoring a
backup, and reading a row can never corrupt it.

No schema in the format uses `.default()`. Optional means optional, and a field
that later becomes required arrives with a migration. Parsing therefore never
adds a key that was not stored, and the only normalisation anywhere is trimming
surrounding whitespace on text. That is what makes it safe to parse a buyer's
content on every render.

### Adding a block, or a field to a block

Add the type to `BLOCK_CONFIG_SCHEMAS` and `BLOCK_REGISTRY`, bump
`CURRENT_DEFINITION_VERSION`, and write the migration. For a new **optional**
field the migration is a version bump with no rewrite. For a new **required**
field the migration supplies the value that reproduces the old rendering
behaviour, so an existing event looks exactly as it did the day before.

### Renaming a block type

A migration rewrites `type` on every block of that kind. It touches no ids, so no
buyer content moves. There is deliberately no alias table: an alias is a second
mechanism that has to agree with the first one, and the version ladder already
handles the case an alias would be for.

### Removing a field from a block

The version 3 migration is the worked example: `rsvp-form.fields` went away and
`fields.guestCount` moved up a level. It is a **rewrite** rather than a version
bump, because `fields` was required in version 2 and the version 3 schema is
strict, so a stored document that kept it would stop validating and the resolver
would omit the block. The rule is the same as for a new required field: the
migration produces the document that reproduces the old rendering.

### Removing a block

The hard direction, done in three steps that can be years apart.

1. **Retire it.** `BLOCK_REGISTRY[type].status` becomes `'retired'`. The schema
   stays, so every document that still contains the block continues to validate.
   `findRetiredBlocks` is what stops it being used in something authored now.
   Nothing in the database changes.
2. **Migrate it out.** A migration either rewrites the block into a surviving
   type, or drops it from the block list. Dropping it leaves the buyer's override
   for that id in `event_content.content`, untouched. `resolveEventPage` reports
   it as `orphanedContent` with the stored value, so a removal is visible instead
   of silent. An event whose `sections` still names the id keeps serving: the id
   is skipped and reported as `unknownSections`, and the next composition change
   the buyer makes stops naming it.
3. **Delete the schema**, only once a query proves no stored document references
   the type. `templates.definition_version` and `events.template_definition_version`
   exist so that query is cheap.

Steps 1 and 2 are reversible. Step 3 is not, which is why it is a separate
decision made with evidence rather than the same afternoon.

## What is validated when

| When                        | What runs                                      | On failure                                       |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| authoring a seed file       | `tests/unit/template/seed.test.ts`             | the pull request goes red                        |
| a buyer saves               | `checkContent` in `src/lib/editor/document.ts` | the field paths are named and nothing is written |
| a guest page renders        | `resolveEventPage(...)`                        | see the table below                              |
| every committed theme       | `tests/unit/template/contrast.test.ts`         | the pull request goes red                        |
| the database, independently | check constraints from Phase 0.2               | the insert fails                                 |

Content cannot be fully validated on its own: it does not know which block types
its ids point at, and only the definition knows that. So the content pipeline
checks structure, and the per block check happens in `resolveEventPage` where
both documents are in hand.

### When stored content no longer validates

The rule is: **fall back when the fallback is a designed artifact, fail when the
fallback would be a lie.**

| Broken                                                | Result  | Why                                                                                                                                                        |
| ----------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| definition                                            | fail    | there is no structure to render                                                                                                                            |
| theme                                                 | fail    | blocks consume tokens and nothing else                                                                                                                     |
| content document                                      | fail    | template defaults are placeholder copy, and showing another couple's names to real guests is worse than a designed error page                              |
| theme override                                        | degrade | a palette is not somebody's words; a correct page in the template palette still serves                                                                     |
| envelope override                                     | degrade | the cover is not the invitation, and an invitation under the template's envelope still serves                                                              |
| one block's override                                  | omit it | the only block that can ever be omitted is one whose buyer content we cannot trust                                                                         |
| every block omitted                                   | fail    | an empty page is not a page                                                                                                                                |
| a composed section id the definition has no block for | skip it | a template can genuinely lose a block, and an invitation that went dark over a change we made to a template is a failure the buyer cannot see the cause of |

In every one of those cases the stored value comes back in the outcome, verbatim.
Nothing is deleted, nothing is rewritten, and nothing throws. A guest gets a page
or a designed error state, never a stack trace.

## Tests

`tests/unit/template/`. `contrast.test.ts` recomputes the WCAG contrast table
for every committed theme, so a token tweak that makes a page unreadable fails a
test rather than shipping. The headline test is `versioning.test.ts`, which builds
a real next version of the format with a genuinely changed block schema, on top of
the ladder that actually shipped, and runs the committed seed document through it.
It also runs a document frozen at version 1, from before the hero gained its
artwork slot, so the bottom rung keeps being climbed as the ladder grows. Each
case runs the same document through a next version that bumped the number and
forgot the migration, and asserts that it fails, so the migrations are proven
load bearing rather than described as such.
