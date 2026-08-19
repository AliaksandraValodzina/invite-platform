# Seed templates

Hand written JSON, seeded into `templates` by hand for Phase 0. There is no
editor and no seller upload; these files are the source.

```
definitions/<key>.json    goes into templates.definition, and its version into
                          templates.definition_version
themes/<key>.json         goes into templates.theme
```

A template row is one definition plus one theme. `classic-invitation` with
`ivory.json` and `classic-invitation` with `midnight.json` are two rows, two
listings and two very different looking pages built from the same block list and
the same words. That is the point of keeping tokens out of the definition.

There are five themes, and they are not the same kind of thing.

| File                     | What it is                                                  |
| ------------------------ | ----------------------------------------------------------- |
| `deckle-and-deboss.json` | The template line: letterpress on cotton, oxblood ink       |
| `masthead.json`          | The template line: modern editorial, didone and ultramarine |
| `foil-and-midnight.json` | The template line: brass foil on midnight, deco capitals    |
| `ivory.json`             | Placeholder from Phase 0.3, not part of the line            |
| `midnight.json`          | Placeholder from Phase 0.3, not part of the line            |

The three directions come from `data/ip-design-directions/report.md` and every
value in them is quoted from it. `docs/design-directions.md` says how each one
landed in this format, what the report needed that the format did not have, and
how to look at all three. Do not adjust a hex, a size or a weight in those three
files: each was chosen against a measured contrast table, and
`tests/unit/template/contrast.test.ts` will fail if one moves.

Every file in here is validated by `tests/unit/template/seed.test.ts`, which runs
in `npm test`. A malformed seed fails the pull request rather than the database
insert.

## Rules a seed file has to follow

- No colour, font, radius or spacing value appears in a definition. Those are
  theme tokens, and a block reads them as CSS custom properties.
- No date, time or time zone appears in a definition. The event row owns those.
  A details item that needs the date uses `"source": "event-date"` rather than
  writing it out, so the countdown and the details list can never disagree.
- Every URL is `https`.
- Colours are opaque hex. A translucent token cannot have its contrast measured,
  and every theme's contrast is measured.
- `accentInk` is the same value as `bg` or `surface`. A label on an accent fill
  is drawn in the page or card colour, never in ink.
- A block `id` is permanent. Event content is stored keyed by it, so changing an
  id in a definition orphans the buyer's content for that block. Add a new block
  with a new id instead.

See `docs/template-format.md` for the format itself and how it changes over time.
