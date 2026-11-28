import type { FloorSpot } from "../map/dungeonWays"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { rng } from "../math/random"
import { HERO_RADIUS, type Monster, type Shot } from "../monster/monsters"
import { type Element, type Gear, GEAR_USES, type GearKind, isThrown } from "./gear"

/**
 * Half the width of something thrown or shot, for hitting monsters
 */
export const SHOT_RADIUS = 0.03 * FIGURE_SCALE

/**
 * World units a thrown weapon flies on after leaving the room or corridor it was thrown in, before it falls
 */
export const FALL_AFTER = 0.5 * FIGURE_SCALE

/**
 * Seconds a weapon takes to fall to the floor
 */
export const FALL_TIME = 0.25

/**
 * Share of the weapons that hit a monster which stick in it, and only fall once it dies
 */
export const STICK_CHANCE = 0.5

/**
 * How far from a wall a weapon that hit it falls, in world units
 */
const WALL_BACK = 0.05 * FIGURE_SCALE

/**
 * How close a hero needs to come to a weapon on the floor to pick it up, in world units
 */
export const PICK_REACH = 2 * HERO_RADIUS

/**
 * Seconds the burst of a glowing ball lasts
 */
export const FLASH_TIME = 0.3

/**
 * Turns per second of a thrown axe, which tumbles over, while a dagger flies straight
 */
const AXE_SPIN = 3

/**
 * Times a step into a wall gets halved to find the wall
 */
const WALL_STEPS = 6

type Thrown = Extract<GearKind, "dagger" | "axe">

/**
 * A thrown weapon or a glowing ball in the air
 */
export interface Flying extends FloorSpot
{
    kind: GearKind
    /** what a ball is made of, missing for weapons */
    element?: Element
    /** id of the hero who threw or shot it */
    owner: number
    /** direction, length 1 */
    dirX: number
    dirZ: number
    /** world units it can still go */
    left: number
    /** room or corridor it was thrown in, -1 for none */
    space: number
    /** world units it went outside of that, -1 while inside */
    outside: number
    /** radians it turned over, for an axe */
    spin: number
    /** where the one who threw it stood, which the monster it hits goes after */
    fromX: number
    fromZ: number
}

/**
 * Weapon on the floor, or falling to it
 */
export interface Lying
{
    kind: Thrown
    owner: number
    x: number
    z: number
    /** direction it points to, as a meeple facing */
    yaw: number
    /** seconds since it started to fall, it can only be picked up after FALL_TIME */
    age: number
    /** height above the floor it fell from */
    height: number
}

/**
 * Weapon that sticks in a monster, until it dies
 */
export interface Stuck
{
    kind: Thrown
    owner: number
    monster: Monster
    /** where it came from, against the turn of the monster */
    side: number
}

/**
 * Burst of a glowing ball that hit something
 */
export interface Flash
{
    element: Element
    x: number
    z: number
    age: number
}

/**
 * What shots need to know about the level
 */
export interface ShotFloor
{
    /**
     * Returns whether there is no wall between two points
     */
    sees(x0: number, z0: number, x1: number, z1: number): boolean

    /**
     * Moves a spot by the given world units, as far as the walls let it, which keeps the face it is on
     */
    move(spot: FloorSpot, dx: number, dz: number): void

    /**
     * Returns the room or corridor a face is in, as an index that tells them apart, -1 for none
     */
    spaceOf(face: number): number
}

/**
 * The monsters as far as shots hit them
 */
export interface ShotTargets
{
    shoot(x0: number, z0: number, x1: number, z1: number, radius: number, fromX: number, fromZ: number, damage: number): Shot | null

    has(monster: Monster): boolean
}

/**
 * What happened to the shots in a frame, for the sounds
 */
export interface ShotEvents
{
    /** what weapons hit, balls only burst */
    hits: Shot[]
    /** weapons that hit a wall */
    walls: number
    /** glowing balls that burst */
    flashes: Flash[]
}


/**
 * Thrown weapons and glowing balls in a level, from flying over lying or sticking in monsters to being picked up again.
 * Plain state without the scene, see plans/action/gear.md.
 */
export default class Shots
{
    readonly flying: Flying[] = []
    readonly lying: Lying[] = []
    readonly stuck: Stuck[] = []
    readonly flashes: Flash[] = []

    constructor(private readonly floor: ShotFloor)
    {
    }

    /**
     * Throws a weapon or shoots a ball of the given gear from a hero
     *
     * @param owner     id of the hero
     * @param from      where the hero stands
     * @param dirX      direction to throw in, length 1
     * @param dirZ      direction to throw in
     */
    launch(owner: number, { kind, element }: Gear, from: FloorSpot, dirX: number, dirZ: number): void
    {
        const flying: Flying = {
            kind,
            ...(element ? { element } : {}),
            owner,
            face: from.face,
            x: from.x,
            z: from.z,
            dirX,
            dirZ,
            left: GEAR_USES[kind].range,
            space: this.floor.spaceOf(from.face),
            outside: -1,
            spin: 0,
            fromX: from.x,
            fromZ: from.z
        }
        this.flying.push(flying)
    }

    /**
     * Returns how many weapons of a kind a hero has out of their hands, flying, lying or sticking in a monster
     */
    outOf(owner: number, kind: GearKind): number
    {
        const counts = (list: readonly { owner: number, kind: GearKind }[]) => list.filter(shot => shot.owner === owner && shot.kind === kind).length
        return counts(this.flying) + counts(this.lying) + counts(this.stuck)
    }

    /**
     * Moves on by a frame
     *
     * @param targets   the monsters
     */
    update(delta: number, targets: ShotTargets): ShotEvents
    {
        const events: ShotEvents = { hits: [], walls: 0, flashes: [] }
        const { flying, lying, stuck, flashes } = this
        for (let i = flashes.length - 1; i >= 0; i--)
        {
            flashes[i].age += delta
            if (flashes[i].age >= FLASH_TIME)
            {
                flashes.splice(i, 1)
            }
        }
        for (const weapon of lying)
        {
            weapon.age += delta
        }
        // those in monsters that died fall where the monster was
        for (let i = stuck.length - 1; i >= 0; i--)
        {
            const { kind, owner, monster } = stuck[i]
            if (!targets.has(monster))
            {
                stuck.splice(i, 1)
                lying.push({ kind, owner, x: monster.x, z: monster.z, yaw: rng.next(0, Math.PI * 2), age: 0, height: monster.kind.radius })
            }
        }
        for (let i = flying.length - 1; i >= 0; i--)
        {
            if (this.fly(flying[i], delta, targets, events))
            {
                flying.splice(i, 1)
            }
        }
        return events
    }

    /**
     * Moves one shot on by a frame
     *
     * @return whether it's done flying
     */
    private fly(shot: Flying, delta: number, targets: ShotTargets, events: ShotEvents): boolean
    {
        const { floor } = this
        const { x, z, dirX, dirZ, kind } = shot
        const { speed, damage } = GEAR_USES[kind]
        let step = Math.min(speed * delta, shot.left)
        let wall = false
        if (!floor.sees(x, z, x + dirX * step, z + dirZ * step))
        {
            // halves the step for as long as it goes, to get close to the wall
            wall = true
            let free = 0
            for (let half = 0; half < WALL_STEPS; half++)
            {
                const middle = (free + step) / 2
                if (floor.sees(x, z, x + dirX * middle, z + dirZ * middle))
                {
                    free = middle
                }
                else
                {
                    step = middle
                }
            }
            step = free
        }
        const toX = x + dirX * step, toZ = z + dirZ * step
        const hit = targets.shoot(x, z, toX, toZ, SHOT_RADIUS, shot.fromX, shot.fromZ, damage)
        if (hit)
        {
            if (isThrown(kind))
            {
                events.hits.push(hit)
            }
            this.land(shot, hit.x, hit.z, events, hit)
            return true
        }
        if (wall)
        {
            events.walls += isThrown(kind) ? 1 : 0
            this.land(shot, toX - dirX * WALL_BACK, toZ - dirZ * WALL_BACK, events)
            return true
        }

        floor.move(shot, toX - shot.x, toZ - shot.z)
        // the floor might not go all the way, the shot still does
        shot.x = toX
        shot.z = toZ
        shot.left -= step
        shot.spin += kind === "axe" ? AXE_SPIN * Math.PI * 2 * delta : 0
        if (shot.space >= 0 && (shot.outside >= 0 || floor.spaceOf(shot.face) !== shot.space))
        {
            shot.outside = Math.max(0, shot.outside) + step
        }
        if (shot.left <= 0 || shot.outside >= FALL_AFTER)
        {
            this.land(shot, toX, toZ, events)
            return true
        }
        return false
    }

    /**
     * Has a shot that is done flying fall, stick in the monster it hit, or burst
     */
    private land(shot: Flying, x: number, z: number, events: ShotEvents, hit?: Shot): void
    {
        const { kind, owner, element } = shot
        if (!isThrown(kind))
        {
            const flash = { element: element ?? "arcane", x, z, age: 0 }
            this.flashes.push(flash)
            events.flashes.push(flash)
            return
        }
        const thrown = kind as Thrown
        // a shield or a kill doesn't keep it, the others do half of the time
        if (hit && !hit.stopped && !hit.killed && rng.next() < STICK_CHANCE)
        {
            this.stuck.push({ kind: thrown, owner, monster: hit.monster, side: Math.atan2(-shot.dirX, -shot.dirZ) - hit.monster.yaw })
            return
        }
        this.lying.push({ kind: thrown, owner, x, z, yaw: Math.atan2(shot.dirX, shot.dirZ), age: 0, height: HERO_RADIUS * 3 })
    }

    /**
     * Has a hero pick up the weapons of theirs on the floor within reach, which have to have landed first
     *
     * @return the kinds of the weapons picked up
     */
    pickUp(owner: number, x: number, z: number): Thrown[]
    {
        const taken: Thrown[] = []
        const { lying } = this
        for (let i = lying.length - 1; i >= 0; i--)
        {
            const weapon = lying[i]
            if (weapon.owner === owner && weapon.age >= FALL_TIME && Math.hypot(weapon.x - x, weapon.z - z) <= PICK_REACH)
            {
                lying.splice(i, 1)
                taken.push(weapon.kind)
            }
        }
        return taken
    }

    /**
     * Gives a hero back the weapons of theirs on the floor, once they landed, for when the hero is out of a fight. Those
     * in the air or in monsters stay.
     *
     * @return the kinds of the weapons given back
     */
    recall(owner: number): Thrown[]
    {
        const taken: Thrown[] = []
        const { lying } = this
        for (let i = lying.length - 1; i >= 0; i--)
        {
            const weapon = lying[i]
            if (weapon.owner === owner && weapon.age >= FALL_TIME)
            {
                lying.splice(i, 1)
                taken.push(weapon.kind)
            }
        }
        return taken
    }

    /**
     * Takes all weapons of a hero out of the level, who leaves them behind
     *
     * @return how many of each kind they lose
     */
    lose(owner: number): Map<GearKind, number>
    {
        const lost = new Map<GearKind, number>()
        for (const list of [this.flying, this.lying, this.stuck] as { owner: number, kind: GearKind }[][])
        {
            for (let i = list.length - 1; i >= 0; i--)
            {
                const { owner: of, kind } = list[i]
                if (of === owner)
                {
                    list.splice(i, 1)
                    if (isThrown(kind))
                    {
                        lost.set(kind, (lost.get(kind) ?? 0) + 1)
                    }
                }
            }
        }
        return lost
    }
}
