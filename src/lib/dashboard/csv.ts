/**
 * The replies, as a file a buyer can open.
 *
 * A caterer wants a spreadsheet, and this is the one place in the product where
 * a stranger's free text is written into a file another program will interpret.
 * Two things follow from that and both are in `cell` below.
 *
 * There is no dependency here on purpose. RFC 4180 escaping is four lines, and
 * a CSV library is a supply chain entry for a function whose whole job is to
 * double a quote mark.
 */

/** The columns that are not questions, in the order a buyer expects to read them. */
export const CSV_FIXED_HEADERS = ['Replied at', 'Coming', 'Guests'] as const

export type CsvRow = readonly (string | null)[]

export function toCsv(headers: readonly string[], rows: readonly CsvRow[]): string {
  const lines = [headers.map(cell).join(',')]
  for (const row of rows) lines.push(row.map(cell).join(','))
  /*
   * CRLF, which RFC 4180 asks for and which is what stops a single field
   * containing a newline from being read as a row break by the stricter
   * readers. Excel on Windows is the one that cares.
   */
  return lines.join('\r\n') + '\r\n'
}

/**
 * One cell, quoted when it has to be and disarmed when it might not be data.
 *
 * **The escaping.** A field containing a comma, a quote or a newline is wrapped
 * in quotes, and a quote inside it is doubled. Guests write commas and
 * newlines. "no pork, and my son is coeliac" is one field, not two.
 *
 * **The formula guard.** A spreadsheet treats a cell beginning `=`, `+`, `-` or
 * `@` as a formula, and some will run it. A guest who types
 * `=HYPERLINK("http://...","click")` into a dietary note has written a live
 * link into the buyer's spreadsheet, and worse is possible. Prefixing a single
 * quote is the standard defence: the spreadsheet shows the text and never
 * evaluates it.
 *
 * A tab and a carriage return are on the list because they are leading
 * whitespace some readers skip before deciding what the first character was.
 */
function cell(value: string | null): string {
  const text = value ?? ''

  const disarmed = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  if (/[",\r\n]/.test(disarmed)) {
    return `"${disarmed.replace(/"/g, '""')}"`
  }
  return disarmed
}

/**
 * A file name a buyer can find again in a downloads folder.
 *
 * The slug rather than the title: a title is a couple's names, and a file
 * called `Priya & Alex.csv` sitting in a downloads folder is a small privacy
 * decision made for somebody else. The slug is already public.
 */
export function repliesFileName(slug: string, isoDate: string): string {
  const day = isoDate.slice(0, 10)
  return `replies-${slug}-${day}.csv`
}
