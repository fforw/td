import type Prando from "prando"
import { BRUTE, type BruteKind } from "./brutes"
import { BIG_CUBOID, type CuboidKind, SMALL_CUBOID } from "./cuboids"
import { type EyeKind, FLYING_EYE } from "./eyes"
import { SOLDIER, type SoldierKind } from "./soldiers"
import { BLUE_WIZARD, PURPLE_WIZARD, RED_WIZARD, type WizardKind } from "./wizards"

/**
 * Kinds of monster each pack of a level takes, by the name of the species
 */
export interface SpeciesKinds
{
    cuboid: CuboidKind
    eye: EyeKind
    brute: BruteKind
    soldier: SoldierKind
    wizard: WizardKind
}

export type Species = keyof SpeciesKinds

/**
 * Part of a group: between min and max monsters of one kind
 */
export type SpawnMember = { [S in Species]: { species: S, kind: SpeciesKinds[S], min: number, max: number } }[Species]

/**
 * Monsters that go into a room together. Which group a room gets is decided once, by the planner, see plans/discovery.md 3.7.
 */
export interface SpawnGroup
{
    name: string
    /** how likely it is picked for a room, relative to the other groups */
    weight: number
    members: readonly SpawnMember[]
}

/**
 * A monster the planner placed, with the room it is in
 */
export type Spawn = { [S in Species]: { species: S, kind: SpeciesKinds[S], face: number, room: number } }[Species]

/**
 * A room with monsters in it, and the group they came from
 */
export interface PlannedRoom
{
    room: number
    group: SpawnGroup
    spawns: Spawn[]
}

/**
 * What the planner gets to know about a level
 */
export interface SpawnLevel
{
    /** faces of each room */
    rooms: readonly (readonly number[])[]
    /** rooms that stay empty, like the one the heroes come in by */
    closed: ReadonlySet<number>
    /** rooms dangerous enough to only have few monsters, see LIMITED_GROUPS */
    limited?: ReadonlySet<number>
}

/**
 * Share of the open rooms with monsters in them. It is about how many had any when each kind still took rooms on its own.
 */
export const ROOMS_TAKEN = 0.42

/**
 * The groups for now, one kind each, weighted like the shares of rooms the kinds took on their own before
 */
export const SPAWN_GROUPS: readonly SpawnGroup[] = [
    { name: "big cuboid", weight: 15, members: [{ species: "cuboid", kind: BIG_CUBOID, min: 1, max: 1 }] },
    { name: "small cuboids", weight: 15, members: [{ species: "cuboid", kind: SMALL_CUBOID, min: 1, max: 3 }] },
    { name: "eye", weight: 7.5, members: [{ species: "eye", kind: FLYING_EYE, min: 1, max: 1 }] },
    { name: "eye pair", weight: 2.5, members: [{ species: "eye", kind: FLYING_EYE, min: 2, max: 2 }] },
    { name: "brute", weight: 8, members: [{ species: "brute", kind: BRUTE, min: 1, max: 1 }] },
    { name: "soldiers", weight: 8, members: [{ species: "soldier", kind: SOLDIER, min: 1, max: 2 }] },
    { name: "blue wizard", weight: 2, members: [{ species: "wizard", kind: BLUE_WIZARD, min: 1, max: 1 }] },
    { name: "red wizard", weight: 2, members: [{ species: "wizard", kind: RED_WIZARD, min: 1, max: 1 }] },
    { name: "purple wizards", weight: 2, members: [{ species: "wizard", kind: PURPLE_WIZARD, min: 2, max: 3 }] }
]

/**
 * The groups for rooms that are dangerous already, with a single monster that doesn't become more
 */
export const LIMITED_GROUPS: readonly SpawnGroup[] = [
    { name: "small cuboid", weight: 15, members: [{ species: "cuboid", kind: SMALL_CUBOID, min: 1, max: 1 }] },
    { name: "eye", weight: 10, members: [{ species: "eye", kind: FLYING_EYE, min: 1, max: 1 }] },
    { name: "soldier", weight: 8, members: [{ species: "soldier", kind: SOLDIER, min: 1, max: 1 }] }
]


/**
 * Decides which rooms of a level get monsters and which, for the whole level at once. The same level and seed give the same
 * plan, so whatever comes later and leaves monsters out, like known floor, has to do so on the plan, not before it.
 *
 * @param level     rooms of the level and which of them stay empty or have few monsters
 * @param random    random numbers from the seed of the level
 * @param groups    groups to pick from
 */
export function planSpawns(level: SpawnLevel, random: Prando, groups: readonly SpawnGroup[] = SPAWN_GROUPS): PlannedRoom[]
{
    const { rooms, closed, limited } = level
    const plan: PlannedRoom[] = []
    rooms.forEach((faces, room) => {
        if (closed.has(room) || random.next() >= ROOMS_TAKEN)
        {
            return
        }
        const group = pickGroup(limited?.has(room) ? LIMITED_GROUPS : groups, random)
        const spawns = group.members.flatMap(member => {
            const count = random.nextInt(member.min, member.max)
            return Array.from({ length: count }, () => ({
                species: member.species,
                kind: member.kind,
                face: faces[random.nextInt(0, faces.length - 1)],
                room
            }) as Spawn)
        })
        plan.push({ room, group, spawns })
    })
    return plan
}


function pickGroup(groups: readonly SpawnGroup[], random: Prando): SpawnGroup
{
    const total = groups.reduce((sum, { weight }) => sum + weight, 0)
    let left = random.next() * total
    for (const group of groups)
    {
        left -= group.weight
        if (left < 0)
        {
            return group
        }
    }
    return groups[groups.length - 1]
}
