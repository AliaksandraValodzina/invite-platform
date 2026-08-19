/**
 * The details icon sprite.
 *
 * `DETAIL_ICONS` is a closed enum in the template format precisely so that an
 * icon name is a key into this file and never a URL, so a template cannot pull
 * a remote asset onto a guest page. Adding an icon means adding a name there
 * and a path here, in that order.
 *
 * Every path draws in `currentColor` and fills nothing. That is what keeps an
 * icon a token consumer: its colour is whatever the element it sits in inherits,
 * and its size is set by the caller from a type token. The numbers in this file
 * are viewBox geometry, which is artwork rather than a theme value.
 *
 * Icons are decorative here. The label next to them carries the meaning, so
 * they are hidden from assistive technology rather than given a second name
 * that would be read out twice.
 */

import type { ReactElement } from 'react'

import { DETAIL_ICONS } from '@/lib/template'

type DetailIcon = (typeof DETAIL_ICONS)[number]

const PATHS: Readonly<Record<DetailIcon, ReactElement>> = {
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  'dress-code': (
    <>
      <path d="M9 3l3 3 3-3" />
      <path d="M9 3 5 6.5V21h14V6.5L15 3l-3 3-3-3Z" />
      <path d="M12 6v15" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="9" width="18" height="12" rx="1.5" />
      <path d="M3 13h18M12 9v12" />
      <path d="M12 9S10.5 3 8 3a2.5 2.5 0 0 0 0 5h4Zm0 0s1.5-6 4-6a2.5 2.5 0 0 1 0 5h-4Z" />
    </>
  ),
  parking: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.6v.3" />
    </>
  ),
}

export function DetailIconGlyph({
  name,
  className,
}: {
  readonly name: DetailIcon
  readonly className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  )
}
