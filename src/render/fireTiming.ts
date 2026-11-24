/*
 * Timing of fire coming down, kept apart from the 3D modules so the game logic can use it
 */

/**
 * Seconds the disc on the floor takes to grow before fire strikes there, which shows with its outline once it is big enough
 */
export const FIRE_WARN = 1

/**
 * Seconds it takes to come down, the last part of the warning
 */
export const FIRE_FALL = 0.4

/**
 * Seconds it hurts from when it strikes
 */
export const FIRE_ACTIVE = 0.2

/**
 * Seconds from the strike until nothing is left of it
 */
export const FIRE_FADE = 1.3
