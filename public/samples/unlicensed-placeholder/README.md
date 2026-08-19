# Unlicensed placeholder artwork

**Nothing in this directory is approved artwork, and nothing in it may ship to a
buyer.** It exists so the hero artwork slot can be looked at on a screen, in all
three design directions, before anyone decides what the real artwork is.

## Rights are unestablished

`invitation-card-UNLICENSED-PLACEHOLDER.jpg` was supplied by the captain on
2026-08-20 as an example of the look they wanted, with the plain statement that
they would find more suitable images later.

Its provenance, author, licence and commercial usage rights are all **unknown**.
It predates the open decision about where template artwork comes from and how it
is licensed, and it must be replaced before anything renders it for a paying
buyer. Treat it the way you would treat a screenshot taken off a search results
page, because that is the level of certainty there is about it.

## The two files

| File                                         | What it is                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `invitation-card-UNLICENSED-PLACEHOLDER.jpg` | The supplied image, byte for byte. 1500x2100, a 5x7in card at 300dpi. Nothing renders it. |
| `floral-band-UNLICENSED-PLACEHOLDER.jpg`     | The band the template actually names.                                                     |

The supplied file is a **complete invitation card**, not a header: "LOVE in
bloom", a name, a date, an address and an RSVP line are painted into the pixels.
Rendered whole above a page that then sets the couple's names, date and venue in
the theme's own type, every one of those appears twice, once as somebody else's
typeface and once as real text. So the band is the artwork out of the card and
not the card.

## How the band was derived

Crop only, from the top edge, plus a resize. **No colour was changed:** nothing
was recoloured, tinted, filtered or adjusted, because how this artwork sits
against each of the three palettes is exactly the thing being judged.

```
crop   (0, 0) to (1500, 800) of the 1500x2100 original
resize 1200x640, Lanczos
save   JPEG, quality 72, progressive, optimised   -> about 98 kB
```

The card's own text starts at about y=840, so the 800px cut leaves roughly 40px
of clear margin above it. Both butterflies and the whole floral crown are inside
the crop.

Re-derive it with any image library, for example:

```python
from PIL import Image
im = Image.open('invitation-card-UNLICENSED-PLACEHOLDER.jpg')
im.crop((0, 0, 1500, 800)).resize((1200, 640), Image.LANCZOS).save(
    'floral-band-UNLICENSED-PLACEHOLDER.jpg', 'JPEG',
    quality=72, optimize=True, progressive=True)
```

## Replacing it

The template names the file, so swapping the artwork is an edit to
`hero.artwork.src` in `templates/definitions/classic-invitation.json` and a new
file. Nothing in `src/` mentions either of these images. See
`docs/blocks.md` for what the block does with whatever it is handed.
