import Prando from "prando"

import { faceCenter } from "../map/dungeonLights"
import { entranceRoom, EXIT_HALF_SIZE, findRoomRoles, type LevelExit, placeExits } from "../map/dungeonRoles"
import { doorFaces } from "../map/dungeonWays"
import { setAgainstWall } from "../map/fixtures"
import type { DungeonLevel } from "../map/generateDungeon"
import type PatchWorld from "../map/PatchWorld"
import { CHEST_HALF_DEPTH, type ChestSpot, placeChests } from "../treasure/chests"

/**
 * Added to the seed of a level for its chests and its exits, to not get the same numbers as anything else
 */
const CHEST_SEED = 0x7c3a
const EXIT_SEED = 0x51d9


/**
 * Returns what stands around in a level. All of it can be gotten to from the entrance, none of it stands in a way in or out of
 * a room.
 *
 * @param level     the level
 * @param world     world with all patches of the level
 * @param segments  walls of the level
 * @param seed      seed of the level
 */
export function placeFixtures(
    { rooms, corridors }: Pick<DungeonLevel, "rooms" | "corridors">,
    world: PatchWorld,
    segments: Float64Array,
    seed: number
): { exits: LevelExit[], chests: ChestSpot[] }
{
    const centerOf = (face: number) => faceCenter(world, face)
    const corridorFaces = corridors.flatMap(({ faces }) => faces)
    const openings = [...corridorFaces, ...doorFaces(world, rooms.flat())].map(centerOf)

    const exits = placeExits(rooms, corridors, openings, centerOf, new Prando(seed + EXIT_SEED))
    for (const exit of exits)
    {
        setAgainstWall(exit, segments, EXIT_HALF_SIZE)
    }

    const { depths } = findRoomRoles(rooms, corridors)
    const taken = new Set([entranceRoom(rooms, corridors), ...exits.map(({ room }) => room)])
    depths.forEach((depth, room) => {
        if (depth === Infinity)
        {
            taken.add(room)
        }
    })
    const chests = placeChests(rooms, openings, centerOf, new Prando(seed + CHEST_SEED), taken)
    for (const chest of chests)
    {
        setAgainstWall(chest, segments, CHEST_HALF_DEPTH)
    }
    return { exits, chests }
}
