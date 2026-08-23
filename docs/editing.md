# Content editing

Stage 7, first half. A buyer fills in their own details on the template they
bought and a guest sees them.

Without this, stages 1 to 3 let somebody pay for an invitation they cannot put
their own names on, which is the difference between a demo and a product.

The route is `/dashboard/<eventId>/edit`. The code is `src/lib/editor/` (pure),
`src/components/editor/` (the controls), `src/lib/supabase/editing.ts` (the reads
and writes, as the buyer) and `src/app/dashboard/[id]/edit/`. Start at
`docs/template-format.md`, because everything here is downstream of it.

## What is in scope, and what is not

**In.** Filling in what a template's sections already have: names, the date and
time, the venue, message text, swapping a photo, and which questions the reply
form asks.

**Out, and deliberately.** Adding, removing or reordering sections. Moving
anything. New block types. A buyer edits content in slots; the composition is
the template they bought. The other half of stage 7 is where sections move.

The editor has no add or remove control for a list entry either, for the same
reason one step down: which items a details list has is composition. A buyer can
change what every item says.

## The form is read out of the format

This is the part worth understanding, because it is what stops the editor
becoming the tarpit AGENTS.md warns about.

A block already declares everything a form needs. `BLOCK_CONFIG_SCHEMAS` says
which keys it has, which are required, how long each may be, which are a closed
set of choices and which are pictures, and it has to say all of that anyway
because it is what validates a save. So the editor reads the schema instead of
being written per block type:

```
BLOCK_CONFIG_SCHEMAS[type]  ->  z.toJSONSchema  ->  Field[]  ->  one control each
```

`src/lib/editor/fields.ts` is the middle of that. It goes through JSON Schema
rather than Zod's internals because `z.toJSONSchema` is a documented surface and
the internals are not, and because the intermediate is one object a test can
print.

**A block type added tomorrow gets an editable form with nobody touching the
editor.** `tests/unit/editor/fields.test.ts` proves it against a sixth block type
that does not exist in this product, using every shape the format has.
`tests/e2e/editing.spec.ts` proves the other half by re-deriving the expected
control names from `readFields` at test time, so a field added to a block schema
is a control the browser suite immediately demands.

### JSON Schema describes the shape. Zod decides what is valid.

A `superRefine` such as "exactly one of value or source" does not survive the
conversion, so the form can offer a combination the schema will reject. That is
correct and not a gap. The Zod schema is the only thing that says yes on a save
(`checkContent` in `src/lib/editor/document.ts`), and a form that lets you type
something wrong and then tells you which field is a normal form. A form that
decided validity for itself would be a second answer to "what is a valid hero".

### What picks a control

Structure, in every case but two. Booleans are toggles, enums are choices,
arrays of enums are checkbox groups, arrays of objects are rows, objects are
groups, and a string is one line or a box depending on the `maxLength` the format
declares (`PARAGRAPH_MIN_LENGTH`, 200: an address and an RSVP introduction get
room, a headline and a button label get a line).

The two exceptions are `.meta()` on the schema, so they travel with the format
rather than living in a table beside it:

| meta                 | On                                                        | Why it cannot be structural                        |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `control: 'url'`     | `httpsUrlSchema`                                          | a URL and a line of prose are both bounded strings |
| `control: 'picture'` | the object `decorativePicture` and `contentPicture` build | `src` and `widths` are one thing a buyer swaps     |

`control: 'picture'` sits on the **object** and never on `src`, and that is load
bearing: swapping a picture changes its address and every stored width together,
so a control that owned only the address would leave a `srcset` pointing at the
picture that was just replaced.

A picture slot also names its `uploadKind`, because the capability stores
different widths for a photograph in the reading column (480/960/1600) than for a
cover drawn full bleed (800/1600). See `src/lib/uploads/kinds.ts`.

### A field with no control

A shape this deploy cannot place becomes `opaque`. It is drawn as "this version
of the editor has no control for it" and **what is stored for it is passed
through untouched on save**. That is what keeps the promise honest for a block
nobody has thought about yet: a form with a hole in it rather than no form, and
nothing lost by the hole.

## Three homes, three saves

A buyer's invitation is not one document, and the page is honest about it
because the split is the data model.

| Form           | Writes                   | Why it is not somewhere else                                                                                                                                    |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The details    | columns on `events`      | the date, the end and the time zone are the source of truth for the countdown. A block config carrying a date would be a second answer to "when is the wedding" |
| The invitation | `event_content.content`  | the buyer's words, as overrides keyed by block id                                                                                                               |
| The reply form | rows in `rsvp_questions` | every question carries the `pii_class` the retention sweep reads                                                                                                |

Each has its own button and its own action, so a failure in one cannot half apply
another.

The slug is not editable. It is the link guests already have,
`events_before_write` refuses to change it once an event has been published, and
there is no way to reach the people holding the old one to correct it.

## A save writes only what changed

Content is stored as overrides so that fixing a typo in a template's default copy
reaches every event that did not override it. An editor that wrote the merged
config back on every save would end that quietly, on the first save, and nobody
would notice until a typo fix failed to arrive.

So `overrideFor` compares the submitted config with the **template's default**,
key by key at the top level, and keeps only what differs. Two rules from the
format are obeyed rather than restated: a nested object is written whole, because
that is how `applyOverride` merges it, and a field the template fills in and the
buyer emptied comes back as `null`, because that is the only way to spell "clear
this" through a key replace.

The sharp end of it is in `tests/e2e/editing.spec.ts`: the seeded fixture stores
an eyebrow and a subhead that are word for word the template's, and a save
removes them. Nothing on the page changes; what changes is that a reworded
eyebrow in the template now reaches that event too.

## Every save is a new published revision

`public.save_event_content` (20260822010000) writes a new revision and moves the
published flag in one transaction. Two requests could leave an event with nothing
published between them, which the guest page answers with a designed notice
standing in for an invitation somebody paid for.

A new revision rather than an update in place, because the table was built for
it: "restore what it said last week" is the request that arrives the day after a
bad edit, and a row edited in place has already thrown it away. The theme
override is carried forward from the revision being replaced, so a buyer's
palette is not reset by saving their words.

There is no draft state and no preview. Each save is a complete document and each
one goes live. A draft edited over several sittings and published once is the
other half of stage 7.

The function is `SECURITY INVOKER`, so row level security decides whose event it
is rather than an ownership check written twice.

## Nothing is written unless all of it can be

A save that would produce a document the guest page could not render is refused
whole, with the field paths named, and the stored row is untouched. Saving the
good half and reporting the rest would leave an event in a state nobody chose.

The read path is the mirror of that. A section whose stored override no longer
validates is **omitted from the guest page** (a template default is not a
stand-in for somebody's words) and **shown in the editor with the reasons**,
because the person looking at the editor is the one who has to fix it. What they
wrote comes back verbatim either way.

Content keyed to a block id the template no longer has survives every save,
untouched. It is what a removed block leaves behind, it is reported rather than
deleted, and an editor that tidied it up would be the only thing between a buyer
and their words if that block came back.

## Pictures

The file goes up on its own, before the save, through `POST /api/uploads`. One
request carrying a whole form plus a 10 MB photograph would make every save as
slow as its slowest picture.

**The form carries an upload id and never an address.** An address in a form is
an address a browser can change, and the server would then be writing whatever
`/a/<key>` it was handed into a buyer's document, including one belonging to
somebody else's event, which would leave `public.claim_upload_objects` counting a
reference nobody can see. Instead the server reads the upload row back as this
buyer (`pictureForUpload`), and row level security is what says it is theirs.

Version 5 of the definition format is what made the photograph reachable at all.
`hero.image.src` was an https URL until then, so the one picture a buyer most
wants to add from the phone in their hand was the one field the upload capability
could not fill. It is now the same `imageSourceSchema` the artwork and the
envelope always used, with the same optional `widths` list, built by the same
`decorativePicture`/`contentPicture` pair. The migration is a version bump with no
rewrite, because both changes are widenings.

Without JavaScript the picture control degrades to what it can honestly offer:
the picture that is already there and a box to remove it. Both are real form
state and both save. Everything else in the editor is text in a box and works
with no JavaScript at all.

## The reply form, and what is missing from it

A buyer chooses which of `DEFAULT_RSVP_QUESTIONS` their event asks and whether
each must be answered. Removing one is `retired_at`, never a delete: `rsvp_answers`
references the question `ON DELETE RESTRICT` and `authenticated` holds no DELETE
privilege on `rsvp_questions` at all, so a buyer tidying their form cannot take
last month's replies with it. `tests/e2e/editing.spec.ts` answers a question,
removes it, and reads the answer back off the replies page.

**There is no box to write a question of your own, and that is a decision rather
than an omission.** Every question carries a `pii_class` that decides what the
retention sweep erases (`docs/replies.md`), and a question in a buyer's own words
is a question somebody has to classify. Who does that is the open captain
decision `ip-product-plan-decision-rsvp-question-freedom`, and inventing an
answer here would be inventing a privacy control. What a buyer picks from is a
set we already classified.

One known rough edge that falls out of that: a live question is matched to a
shipped one by its prompt, which is exact today because prompts are not editable.
Rewording a shipped prompt later would make an existing row stop matching, and
the editor would offer the reworded question as if the event did not ask it. The
cost is a duplicate offered, not data lost, and the fix arrives with whatever
answers the decision above.

## Auth

There is none to build. Sign-in shipped with the dashboard: a magic link, two
HTTP-only cookies, and `src/proxy.ts` keeping the access token fresh. The editor
is under `/dashboard/:path*`, so it inherits both that refresh and the
`private, no-store` header.

Every action re-reads the session and the event itself, rather than trusting the
page that rendered the form, because a server action is a POST endpoint reachable
directly. The check is row level security in the database on `events`,
`event_content`, `rsvp_questions` and `uploads`, so the worst a bug in this code
can do is fail: it cannot write into somebody else's wedding. An event that is
not yours and an event that does not exist give the same answer.

One read on this path uses the service role, and it is worth naming rather than
leaving to be discovered: the template's own `definition` and `theme`. A buyer
does not own the template they activated, the seller does, and `templates` has
one policy that says `owner_id = auth.uid()`. Which event this is, and whether
it is theirs, is still row level security; the second read is keyed by an id the
database just handed that buyer and returns two design documents with nothing of
anybody's in them. `docs/activation.md` has the whole argument and the schema
change that would replace it.

## The load bearing detail warning

A save that moves the date, the time zone, the venue or the address on an
invitation that already has replies stops and asks, showing the count. It is a
confirmation and never a block, and nothing is sent to guests either way. The
list, why it cannot be derived from the format, and how the pending save
survives being asked about are in `docs/activation.md`.

## Caching

A save calls `updateTag(eventCacheTag(slug))`, not `revalidateTag`. The
difference is the point: `revalidateTag` marks the entry stale and serves the
stale copy while a fresh one is built, which is right for a catalogue and wrong
here. A buyer who pressed save and then opened their own link has to see what
they saved, and being shown the previous version for another minute reads as "it
did not save".

The guest page's own 60 second lifetime is untouched. That number is a privacy
bound rather than a speed one (`src/lib/serving/cache.ts`); this is the other
direction, dropping one named event's copy on purpose.

## Tests

`tests/unit/editor/` for the three pure modules, and `tests/e2e/editing.spec.ts`
for the loop. Every assertion in the browser suite reads a value off the page a
**guest** gets, not the absence of an error on the page the buyer typed into: a
save that says "Saved" and changes nothing is exactly the bug worth catching, and
it is invisible to a test that only looks at the editor.
