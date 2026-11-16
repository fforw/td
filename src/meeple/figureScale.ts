/*
 * Size of the heroes and monsters in a level against the level, kept apart from the 3D modules so the game logic can use
 * it
 */

/**
 * How much larger a level looks on the screen than it used to, with the camera closer by as much
 */
export const LEVEL_GROWTH = 1.5

/**
 * How much larger heroes and monsters look on the screen than they used to
 */
export const FIGURE_GROWTH = 1.1

/**
 * Factor on everything about heroes and monsters in a level that is measured in world units: their bodies, how far they
 * reach, how fast they go. With it, a level is larger by LEVEL_GROWTH / FIGURE_GROWTH against them.
 */
export const FIGURE_SCALE = FIGURE_GROWTH / LEVEL_GROWTH
