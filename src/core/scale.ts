/*
 * Scale of the map, kept apart from the 3D modules so the map worker can use it
 */

/**
 * Size of the hexagon patch faces in 2D units
 */
export const FACE_SIZE = 40

/**
 * Scale from 2D plan units to 3D world units. One face is roughly one world unit, which is the grid size of the
 * Kenney kits.
 */
export const SCALE = 1 / FACE_SIZE
