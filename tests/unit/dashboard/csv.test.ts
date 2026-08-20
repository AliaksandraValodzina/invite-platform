import { describe, expect, it } from 'vitest'

import { repliesFileName, toCsv } from '@/lib/dashboard/csv'

/**
 * The export is the one place in this product where a stranger's free text is
 * written into a file that another program interprets. Both of the things that
 * can go wrong there are tested by writing the attack, not by describing it.
 */

describe('writing a CSV', () => {
  it('keeps a field with a comma in it as one field', () => {
    const csv = toCsv(['Note'], [['no pork, and my son is coeliac']])

    expect(csv).toBe('Note\r\n"no pork, and my son is coeliac"\r\n')
  })

  it('doubles a quote rather than ending the field on it', () => {
    const csv = toCsv(['Note'], [['they said "bring a plate"']])

    expect(csv).toBe('Note\r\n"they said ""bring a plate"""\r\n')
  })

  it('keeps a newline inside a field instead of starting a row', () => {
    const csv = toCsv(['Note'], [['line one\nline two']])

    expect(csv).toBe('Note\r\n"line one\nline two"\r\n')
  })

  it('writes an unanswered question as an empty field, not as the word null', () => {
    expect(toCsv(['Note'], [[null]])).toBe('Note\r\n\r\n')
  })
})

describe('a guest who writes a formula', () => {
  /**
   * A spreadsheet treats a cell beginning `=`, `+`, `-` or `@` as a formula,
   * and some will run it on open. A guest typing that into a dietary note is
   * writing into the buyer's spreadsheet, and the buyer opened the file
   * expecting a list of names.
   *
   * The defence is a leading apostrophe, which the spreadsheet strips when it
   * displays the cell and which stops it evaluating anything.
   */
  it('disarms a cell that starts with an equals sign', () => {
    const csv = toCsv(['Note'], [['=HYPERLINK("http://example.test","click me")']])

    expect(csv).toContain(`"'=HYPERLINK`)
    expect(csv.startsWith('Note\r\n=')).toBe(false)
  })

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\t=1+1', '\r=1+1'])(
    'disarms %j, including the leading whitespace a reader would skip',
    (value) => {
      const csv = toCsv(['Note'], [[value]])
      const cell = csv.split('\r\n')[1] ?? ''

      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true)
    }
  )

  it('leaves ordinary text alone, so a disarmed file is not a mangled one', () => {
    expect(toCsv(['Note'], [['coeliac']])).toBe('Note\r\ncoeliac\r\n')
    expect(toCsv(['Note'], [['2 + 2 people']])).toBe('Note\r\n2 + 2 people\r\n')
  })
})

describe('naming the file', () => {
  /**
   * The slug, not the title. A file called `Priya & Alex.csv` in a downloads
   * folder is a small decision made about somebody else's privacy; the slug is
   * already a public URL.
   */
  it('uses the slug and the day, and no names', () => {
    expect(repliesFileName('priya-and-alex-a1b2c3', '2027-03-15T04:05:06.000Z')).toBe(
      'replies-priya-and-alex-a1b2c3-2027-03-15.csv'
    )
  })
})
