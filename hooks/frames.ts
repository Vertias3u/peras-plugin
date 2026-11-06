// Clawd, drawn by hand, one letter to a pixel. H is the lit top, B the body, S the
// shade, E an eye, W the glint in an eye, "." is empty. Two pixels share one terminal
// cell, top and bottom, and each keeps its own colour. The outline never changes
// while Claude works: Clawd breathes in colour, blinks, and now and then glances at
// the bars.

export const STEP_MS = 125

// Four seconds a breath, 15 a minute, the pace of someone at rest.
const BREATH_STEPS = 32
const BLINK_EVERY = 42
const GLANCE_EVERY = 48
const GLANCE_FROM = 35
const GLANCE_UNTIL = 44

type Pose = { isWorking: boolean; paused: boolean; step: number }
type Sprite = Record<'open' | 'glance' | 'blink' | 'asleep', readonly string[]>

// Full: 13 by 8 pixels, the whole of Clawd.
export const MASCOT_COLUMNS = 13
export const MASCOT_ROWS = 4
const FULL: Sprite = {
  open: [
    '...HHHHHHH...',
    '..BBBBBBBBB..',
    'SBBBBBBBBBBBS',
    'SBBWEBBBWEBBS',
    '..BEEBBBEEB..',
    '..BBBBBBBBB..',
    '..S.S...S.S..',
    '..S.S...S.S..',
  ],
  glance: [
    '...HHHHHHH...',
    '..BBBBBBBBB..',
    'SBBBBBBBBBBBS',
    'SBBBWEBBBWEBS',
    '..BBEEBBBEE..',
    '..BBBBBBBBB..',
    '..S.S...S.S..',
    '..S.S...S.S..',
  ],
  blink: [
    '...HHHHHHH...',
    '..BBBBBBBBB..',
    'SBBBBBBBBBBBS',
    'SBBBBBBBBBBBS',
    '..BSSBBBSSB..',
    '..BBBBBBBBB..',
    '..S.S...S.S..',
    '..S.S...S.S..',
  ],
  asleep: [
    '.............',
    '.............',
    '.............',
    '...HHHHHHH...',
    '..BBBBBBBBB..',
    '..BEEBBBEEB..',
    'HHBBBBBBBBBHH',
    'HHBBBBBBBBBHH',
  ],
}

// Mini: 11 by 4 pixels, Clawd's head peeking over the edge of the band.
const MINI: Sprite = {
  open: ['..HHHHHHH..', '.BWEBBBWEB.', '.BEEBBBEEB.', 'HHBBBBBBBHH'],
  glance: ['..HHHHHHH..', '.BBWEBBBWE.', '.BBEEBBBEE.', 'HHBBBBBBBHH'],
  blink: ['..HHHHHHH..', '.BBBBBBBBB.', '.BSSBBBSSB.', 'HHBBBBBBBHH'],
  asleep: ['...........', '...........', '..HHHHHHH..', 'HBEEBBBEEBH'],
}

function frameOf(sprite: Sprite, pose: Pose): readonly string[] {
  if (pose.paused) return sprite.asleep
  if (!pose.isWorking) return sprite.open
  if (pose.step % BLINK_EVERY === BLINK_EVERY - 1) return sprite.blink
  const glancing = pose.step % GLANCE_EVERY >= GLANCE_FROM && pose.step % GLANCE_EVERY < GLANCE_UNTIL
  return glancing ? sprite.glance : sprite.open
}

export const fullFrame = (pose: Pose) => frameOf(FULL, pose)
export const miniFrame = (pose: Pose) => frameOf(MINI, pose)

/** How far through a breath Clawd is, from 0 to 1. Clawd only breathes while working. */
export function breath(pose: Pose): number {
  if (pose.paused || !pose.isWorking) return 0
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * pose.step) / BREATH_STEPS)
}
