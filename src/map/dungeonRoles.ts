import type Prando from "prando"

import type { Corridor } from "./dungeonCorridors"
import { clearestSpot, type FixtureSpot, outerSpot } from "./fixtures"

/**
 * Chance of a level to have a second exit off the main path
 */
export const SIDE_EXIT_CHANCE = 0.2

/**
 * Half the width and depth of an exit in world units
 */
export const EXIT_HALF_SIZE = 0.3

/**
 * How close to the middle of an exit in world units a hero has to be to take it
 */
export const EXIT_REACH = 0.6

/**
 * What the connections of the rooms of a level say about them. The rooms and corridors are a tree, with the first room, which
 * has the entrance, as its root.
 */
export interface RoomRoles
{
    /** how far the rooms are from the first room in faces of the way, about, Infinity for a room that can't be reached */
    depths: number[]
    /** room each room gets reached through, -1 for the first room and for rooms that can't be reached */
    parents: number[]
    /** rooms from the first room to the deepest one, in that order */
    mainPath: number[]
    /** room furthest off the main path, in steps along the corridors, null if the main path has all rooms */
    farBranch: number | null
}

/**
 * An exit of a level
 */
export interface LevelExit extends FixtureSpot
{
    room: number
}


/**
 * Works out what role the rooms of a level play
 *
 * @param rooms     faces of each room of the level
 * @param corridors corridors between the rooms
 */
export function findRoomRoles(rooms: readonly (readonly number[])[], corridors: readonly Pick<Corridor, "from" | "to" | "faces">[]): RoomRoles
{
    const depths = rooms.map(() => Infinity)
    const parents = rooms.map(() => -1)
    depths[0] = 0
    const open = [0]
    while (open.length > 0)
    {
        const room = open.pop()!
        for (const { from, to, faces } of corridors)
        {
            const next = from === room ? to : to === room ? from : -1
            if (next >= 0 && depths[next] === Infinity)
            {
                // getting through a room takes about as many faces as it is across
                depths[next] = depths[room] + faces.length + Math.sqrt(rooms[next].length)
                parents[next] = room
                open.push(next)
            }
        }
    }

    let deepest = 0
    depths.forEach((depth, room) => {
        if (depth !== Infinity && depth > depths[deepest])
        {
            deepest = room
        }
    })
    const mainPath = [deepest]
    while (parents[mainPath[0]] >= 0)
    {
        mainPath.unshift(parents[mainPath[0]])
    }

    let farBranch: number | null = null
    let furthest = 0
    depths.forEach((depth, room) => {
        if (depth !== Infinity)
        {
            let off = 0
            for (let on = room; !mainPath.includes(on); on = parents[on])
            {
                off++
            }
            if (off > furthest)
            {
                furthest = off
                farBranch = room
            }
        }
    })
    return { depths, parents, mainPath, farBranch }
}


/**
 * Returns the exits of a level: always one at the end of the main path, which is as far from the entrance as it gets, and
 * sometimes one on the branch furthest off of it.
 *
 * @param rooms     faces of each room of the level
 * @param corridors corridors between the rooms
 * @param openings  centers of the faces to stay away from
 * @param centerOf  returns the center of a face in world units
 * @param random    random numbers, for the same level to always have the same exits
 */
export function placeExits(
    rooms: readonly (readonly number[])[],
    corridors: readonly Pick<Corridor, "from" | "to" | "faces">[],
    openings: readonly (readonly number[])[],
    centerOf: (face: number) => readonly number[],
    random: Prando
): LevelExit[]
{
    const { mainPath, farBranch } = findRoomRoles(rooms, corridors)
    const exitIn = (room: number): LevelExit => ({
        room,
        // a level can't go without, even if there is no good place
        ...(outerSpot(rooms[room], openings, centerOf, random) ?? clearestSpot(rooms[room], openings, centerOf))
    })
    const main = exitIn(mainPath[mainPath.length - 1])
    // after the first number, which hardly changes between seeds next to each other
    return farBranch !== null && random.next() < SIDE_EXIT_CHANCE ? [main, exitIn(farBranch)] : [main]
}
