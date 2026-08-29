# Order numbers

The buyer types the order number from their Etsy receipt and gets their
template. This is what a paid listing was waiting on: until it existed, nothing
could be sold, because nobody could prove they had paid.

The code is `src/lib/activation/order-number.ts` (pure), `src/lib/activation/order.ts`
(service role), `src/lib/activation/order-throttle.ts`, `src/app/order/` (the
form and the page a number resolves to), `scripts/load-orders.ts` and
`scripts/list-orders.ts` (what the captain runs), and
`supabase/migrations/20260830010000_order_numbers.sql`. Start at
`docs/activation.md` for the other three links and what a buyer does after they
have an invitation.

## The decision, and the objection that was overruled

The captain chose this twice: on 26 August and again on 29 August after
firstmate put the objection to them directly. **It is settled.**

The objection was real and is worth keeping written down: verifying a typed
order number against Etsy needs the same Open API v3 access that a fully
automatic flow needs, so a form in front of it does not avoid the API, it just
moves where the waiting happens.

What closes that hole is a list rather than a live call. Etsy shows the captain
every order in their own dashboard, so the site checks a typed number against a
list the captain loads from it, periodically, in batches:

- **the buyer is self-serve** — types the number, gets the template, no waiting
  on a human, which is the only property the two rejected options could not have
- **the captain works in batches** — minutes a week rather than thirty seconds
  per sale
- **nothing is trusted** — a number that is not on the list is refused
- **no Etsy API, no approval, no terms to clear**

It upgrades cleanly: the day the API is approved, the same rows are written by
something other than a hand and nothing else changes. Nothing here is built for
that day.

## What the captain does

Once a week, or after a run of sales:

```
node scripts/load-orders.ts --template classic-invitation --file ./EtsySoldOrders.csv
```

The file may be Etsy's own export or a plain list of numbers, one per line.
Blank lines are ignored and so are comments, where a comment is a `#` followed
by anything but a digit, so a receipt pasted as `#3812457901` is still an order
number.

**Re-loading the same export is safe and is the intended way to use it.** A
number already on the list is skipped rather than duplicated, so the captain
never has to remember where they got to.

**A table whose order column cannot be named is refused whole**, rather than
read from the left. The shape gate is deliberately tolerant, so a date column
reads as a run of digits: guessing at a column would quietly put `08292026` on
the list as a purchase nobody made, and the captain would find out when a
stranger typed it. Either export from Etsy with its own headings, or paste the
order number column into a file of one number per line.

Then to see what happened to them:

```
node scripts/list-orders.ts --status unclaimed
node scripts/list-orders.ts --file ./EtsySoldOrders.csv
```

The first lists what is on the list with each number **masked to its last four
characters**, because that is all the database holds. The second takes numbers
the captain already has, hashes each one and prints it in full beside what it
did. That second form is the reconciliation, and it is also the answer to "my
order number does not work": one buyer, one line, claimed or not and when.

## Why the numbers are stored hashed

A number on this list opens a paid template, so a database dump must not hand
somebody a stack of unclaimed purchases. `order_numbers.number_hash` holds
`sha256(normalised)` and nothing holds the number itself, exactly as
`activation_codes.code_hash` does at the other end of the flow.

`number_suffix` keeps the last four characters in the clear so support can find
the row a buyer is reading out. Four is not enough to guess the rest.

The cost is that the captain cannot read their own list back in full, which is
why `--file` exists: the reconciliation runs from the numbers they already hold
rather than from the database.

## Why this is not a row in `activation_codes`

The two look alike and are not the same thing.

|                     | activation code                     | order number                                 |
| ------------------- | ----------------------------------- | -------------------------------------------- |
| where it comes from | minted here                         | printed on the buyer's Etsy receipt          |
| how big             | 20 characters, 100 bits             | about ten digits                             |
| guessable           | no, in the way a password is not    | **yes, by anybody with a loop**              |
| who has it          | one buyer, sent in an order message | the buyer, Etsy, and anybody they show it to |

Putting them in one column would make
`20260819010700_activation_codes.sql` untrue of its own table, would make
`/claim/<order number>` resolve, and would mean the two could never be given
different guessing defences. They are separate tables for the same reason the
activation links are separate routes.

## The hole this design has, and what bounds it

Ten digits is not a hundred bits. Somebody with a loop can walk the space around
a real order number, and every hit is a paid buyer's invitation taken before
they arrive. Hashing the column does nothing about that, because the form hashes
whatever is typed. Neither does refusing to say whether a number is known: the
product has to refuse an unknown number in a sentence naming what to do next,
which is an answer either way.

Three things bound it, and only the first is a defence:

1. **A cap on MISSES per client**, counted in the database by
   `public.note_order_number_miss` rather than in a function's memory, because a
   serverless instance does not share memory with the one next to it. Thirty
   misses in fifteen minutes. It costs an attacker a proxy pool, not a rethink,
   and it is not offered as more than that.
2. **A hit is worth one invitation, once.** The number is single use, enforced
   by a compare and set on `status=eq.issued`, so a guesser takes exactly one
   order rather than a catalogue.
3. **The captain can see it happen.** `scripts/list-orders.ts` shows which
   numbers were claimed and when, so an order claimed before its buyer arrived
   is visible rather than inferred from a complaint.

**Misses rather than attempts**, because enumeration is made of misses: an
attacker has to be wrong thousands of times to be right once. Counting every
attempt would spend a shared address's budget on the people the cap is there to
protect, and a wedding venue, an office and a mobile carrier all put many buyers
behind one address.

**It fails open, deliberately**, three ways: no client address, a loopback
address, or a database that will not answer. A buyer who has paid must never be
refused their template by the thing that counts guesses. Loopback is not an
exception so much as a correction: it names the machine the server runs on
rather than anybody's client, so a deployment whose proxy forwards it would put
every visitor in one bucket, which is worse than no bucket. It is also what
keeps the browser suite deterministic on a local stack.

`platform.order_number_misses` keeps a hashed client address for one window and
the next call deletes it, which is the whole of its retention: it has no
scheduled sweep because it is only ever read by those two functions, and a sweep
that silently stopped would leave a growing log of who typed what.

## The two pages

`/order` is the form. It is the only link that goes in a listing, and
`scripts/load-orders.ts` prints it built from `NEXT_PUBLIC_SITE_URL` so no host
is hardcoded anywhere.

`/order/<number>` is where a recognised number resolves to, and it is the page
that actually redeems. Two pages rather than one because this one has to be
reachable by URL: it is where the magic link comes back to, and a form that
redeemed in place would have nowhere to return to after sign-in. It is also the
page a buyer can be sent directly, which makes support a link rather than an
instruction.

Both are `private, no-store` from `src/proxy.ts`, and `tests/e2e/caching.spec.ts`
reads that off the wire. A cached "still unclaimed" is a page telling the next
visitor to help themselves.

## Redeeming, and the second tap

Identical to a claim, and it has to be. A buyer who double-taps on a phone sends
two requests and neither may show a used-number refusal about something they
just bought. The row is read first, the redemption is a compare and set on
`status=eq.issued`, and the loser takes its own event back.
`docs/activation.md` documents all three at length; `src/lib/activation/order.ts`
is the same three against a different table.

**A different account is the opposite case and gets the refusal.** That is the
whole reason the list is single use: an order number travels, and the first
buyer to post theirs publicly must not be handing the template out.

## Signing in from a recognised number creates the account

`/login` asks the auth API with `should_create_user: false`, because an address
typed into a form is not evidence of anything. Three pages ask with it true, and
they are the three authorisations this product recognises for becoming a
customer: an unspent activation code, a published template offered free, and a
purchase on this list. The number is re-read inside the action rather than
trusted from the page that rendered the form, because a server action is a POST
endpoint reachable directly.

A number that is used, revoked or lapsed still gets a sign-in link, because the
person holding it may well have an account already and the answer they need is
on the other side of signing in. It just does not get an account created for it.

## What this does not replace

`/claim/<code>`, `scripts/issue-codes.ts` and `activation_codes` are untouched.
They are what the captain sends when something has gone wrong with an order: a
refund reissued, a number that never reached the list, a buyer who cannot find
their receipt. Two paid routes, and they can both be live at once.

`/t/<templateId>/use`, the free launch's open copy link, is the one that has to
be **withdrawn before the first paid listing publishes**, because an open copy
link plus a price is a free product. This work is what makes withdrawing it
possible; it does not do it, because the free launch is still running.

## Tests

`tests/e2e/order-number.spec.ts` walks the loop: the form, the sign-in round
trip, the cookie carrier when the link loses its query, the second tap by the
same buyer opening the same invitation, a second account refused in a sentence,
an unknown number refused at the form and at the URL, and the four characters
the page quotes for support.

`tests/unit/activation/order-number.test.ts` holds the TypeScript to the
migration: the normalisation rule, the suffix shape, single use, and that this
work left the claim path alone. `tests/unit/activation/load-orders.test.ts`
covers reading a batch, including the Etsy export and the file that has to be
refused. `tests/unit/auth/destination.test.ts` covers the order path as a
magic-link destination.

`supabase/tests/12_order_numbers.test.sql` covers normalisation, the unique
index, the all-or-nothing redemption, who can read the list, and the throttle's
counting and its own retention. `scripts/check-anon-access.mjs` proves over HTTP
that neither an anonymous client nor a signed-in stranger can read the list,
hash a number, or redeem somebody else's order.
