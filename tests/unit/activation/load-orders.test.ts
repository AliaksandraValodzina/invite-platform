import { describe, expect, it } from 'vitest'

import { csvFields, readBatch } from '../../../scripts/load-orders'

/**
 * Reading the captain's batch, which is the manual half of order verification.
 *
 * This is the file the whole design rests on: a number that never makes it out
 * of the export is a paid buyer refused at the form, and they have no way of
 * knowing why. So the two shapes the captain actually has are asserted, and so
 * is the failure that has to be loud rather than quiet: a file whose numbers
 * are in a column this did not read comes back as "skipped every line" rather
 * than as "loaded nothing".
 */

describe('a CSV line', () => {
  it('splits on commas, and on tabs for a column pasted out of a spreadsheet', () => {
    expect(csvFields('3812457901,Sold,2026-08-30')).toEqual(['3812457901', 'Sold', '2026-08-30'])
    expect(csvFields('3812457901\tSold')).toEqual(['3812457901', 'Sold'])
  })

  it('keeps a quoted comma inside its field, which is where a buyer address lives', () => {
    expect(csvFields('3812457901,"Smith, Wilhelmina",AU')).toEqual([
      '3812457901',
      'Smith, Wilhelmina',
      'AU',
    ])
  })

  it('unescapes a doubled quote rather than splitting on it', () => {
    expect(csvFields('3812457901,"the ""good"" one"')).toEqual(['3812457901', 'the "good" one'])
  })
})

describe("Etsy's own export", () => {
  const EXPORT = [
    'Sale Date,Order ID,Buyer,Item Name',
    '08/29/2026,3812457901,wilhelmina,"Wedding invitation, printable"',
    '08/29/2026,3812457902,bartholomew,Wedding invitation',
  ].join('\n')

  it('finds the order numbers by their column name, not by position', () => {
    expect(readBatch(EXPORT).numbers).toEqual(['3812457901', '3812457902'])
  })

  it('skips nothing when every row has a number', () => {
    expect(readBatch(EXPORT).skipped).toEqual([])
  })
})

describe('a plain list', () => {
  it('reads one number per line', () => {
    const batch = readBatch('3812457901\n3812457902\n')
    expect(batch.numbers).toEqual(['3812457901', '3812457902'])
  })

  it('ignores blank lines and comments, so a working file can be annotated', () => {
    const batch = readBatch('# august\n\n3812457901\n\n# september\n3812457902\n')
    expect(batch.numbers).toEqual(['3812457901', '3812457902'])
  })

  /*
   * The two readings of `#` in one file, and the one that has to win. A receipt
   * pasted as `#3812457901` is a paid order, and dropping it as a comment would
   * take it out of the batch with nothing said.
   */
  it('reads a hash followed by a digit as a receipt, not as a comment', () => {
    const batch = readBatch('# august\n#3812457901\n')
    expect(batch.numbers).toEqual(['3812457901'])
  })

  it('normalises what it reads, so a pasted "#3812 457901" is the same order', () => {
    expect(readBatch('#3812 457901').numbers).toEqual(['3812457901'])
  })

  /*
   * Re-loading a whole export is the expected way to use this, so the same
   * number appearing twice in one file must not become two rows. The unique
   * index would refuse the second anyway; deduplicating here is what keeps the
   * count printed at the end honest.
   */
  it('deduplicates within one file', () => {
    expect(readBatch('3812457901\n3812-457901\n3812457902').numbers).toEqual([
      '3812457901',
      '3812457902',
    ])
  })
})

describe('a file whose numbers are somewhere else', () => {
  /*
   * The failure that has to be loud, and the reason a table is refused whole
   * rather than read from the left. The shape gate is tolerant, so "08/29/2026"
   * normalises to eight digits and passes it: reading the first column of this
   * file would put a date on the list as a purchase nobody made, and the
   * captain would find out when a stranger typed it.
   */
  it('refuses a table whose order column it cannot name', () => {
    const batch = readBatch(
      ['Sale Date,Buyer,Item Name', '08/29/2026,wilhelmina,Invitation'].join('\n')
    )

    expect(batch.numbers).toEqual([])
    expect(batch.refused).toContain('none of them is named')
  })

  it('does not mistake a date for an order number, which is what that buys', () => {
    const batch = readBatch(
      ['Sale Date,Buyer,Item Name', '08/29/2026,wilhelmina,Invitation'].join('\n')
    )

    expect(batch.numbers).not.toContain('08292026')
  })

  it('still reports a single row with nothing in the order column', () => {
    const batch = readBatch(['Order ID,Buyer', ',wilhelmina', '3812457901,bartholomew'].join('\n'))

    expect(batch.numbers).toEqual(['3812457901'])
    expect(batch.skipped).toEqual([',wilhelmina'])
    expect(batch.refused).toBeUndefined()
  })
})
