/**
 * The plan, drawn.
 *
 * Deliberately dull. Every position, size, colour and family has already been
 * decided in plan.ts, so this file places absolutely positioned boxes and does
 * no styling of its own. There is not a single literal colour, font, radius or
 * spacing value here, which is the rule the whole token set exists to make
 * followable, and it is also what makes the layout testable without a renderer.
 *
 * One thing here is not merely placement: the lines are drawn as planned and
 * are not allowed to re-wrap. Satori does its own wrapping, and the plan's line
 * count is an estimate made without font metrics, so the two can disagree. When
 * they did, the extra line pushed the block past its slot and the clip removed
 * a line from the middle of the title, which on a real render meant a card that
 * had quietly dropped one of the two names on the invitation and still looked
 * perfectly composed.
 *
 * So each planned line is its own non wrapping row. A line the estimate got
 * wrong now hangs over the edge of its slot and is clipped there, which is
 * something the Playwright suite can see and does assert, rather than something
 * that silently rearranges the words.
 */

import type { ReactElement } from 'react'

import type { OgCardPlan } from './plan'

export function renderOgCard(plan: OgCardPlan): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: plan.width,
        height: plan.height,
        backgroundColor: plan.background,
      }}
    >
      {plan.slots.map((slot) =>
        slot.kind === 'rule' ? (
          <div
            key={slot.name}
            style={{
              position: 'absolute',
              left: slot.box.x,
              top: slot.box.y,
              width: slot.box.width,
              height: slot.box.height,
              backgroundColor: slot.color,
              borderRadius: slot.radius,
            }}
          />
        ) : (
          <div
            key={slot.name}
            style={{
              position: 'absolute',
              left: slot.box.x,
              top: slot.box.y,
              width: slot.box.width,
              height: slot.box.height,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              color: slot.color,
              fontFamily: slot.fontFamily,
              fontSize: slot.fontSize,
              fontWeight: slot.fontWeight,
              letterSpacing: slot.letterSpacing,
              lineHeight: slot.lineHeight,
            }}
          >
            {slot.lines.map((line, index) => (
              <div key={`${slot.name}-${index}`} style={{ whiteSpace: 'nowrap' }}>
                {line}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
