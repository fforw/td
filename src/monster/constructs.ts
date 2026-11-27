import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { BLOCK_ANGLE, segmentDistance } from "./eyes"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, type Prey } from "./monsters"

const TAU = Math.PI * 2

/**
 * Seconds between looking around
 */
const LOOK_TIME = 0.25

/**
 * Shortest and longest way to the next point while a construct has nobody to go after, in world units
 */
const WANDER_MIN = 0.4 * FIGURE_SCALE
const WANDER_MAX = 1.4 * FIGURE_SCALE

/**
 * Least and most seconds a construct holds still at a point
 */
const PAUSE_MIN = 0.4
const PAUSE_MAX = 1.6

/**
 * Seconds a zip takes, from where the construct is, through the hero, to as far behind them. It eases in by the fifth power
 * of the time, so it creeps for most of it, which is the warning, and passes the hero at 0.5^(1/5), about 87% of it.
 */
export const ZIP_TIME = 1.1

/**
 * Fastest a zip gets in world units per second. A long zip takes longer than ZIP_TIME instead, as its speed at the end is
 * 5 times its length by its time.
 */
export const MAX_ZIP_SPEED = 14 * FIGURE_SCALE

/**
 * Least distance behind the hero a zip goes, in world units, so one close by still goes through
 */
export const MIN_BEHIND = 0.8 * FIGURE_SCALE

/**
 * How much shorter the part behind the hero gets for each try when a wall is in the way
 */
const BEHIND_SHRINK = 0.75

/**
 * Seconds a construct holds still after a zip, and after a blow
 */
export const RECOVER_TIME = 0.9
const STAGGER_TIME = 0.4

/**
 * Speed in world units per second a shield throws a construct back with
 */
const RECOIL_SPEED = 3 * FIGURE_SCALE

/**
 * How fast the cage of a construct spins, and while it zips, in radians per second
 */
const SPIN = 1.2
const ZIP_SPIN = 9


export interface ConstructKind extends MonsterKind
{
    /** hit points a zip takes */
    damage: number
    /** how fast it flies from point to point in world units per second */
    speed: number
}

export const CONSTRUCT: ConstructKind = {
    scale: 1,
    radius: 0.11 * FIGURE_SCALE,
    mass: 0.8,
    hp: 4,
    big: false,
    flying: true,
    // at the height it hovers at
    burst: [{ x: 0, y: 1.05, z: 0, rx: 0.35, ry: 0.35, rz: 0.35, colors: ["#8a9099", "#5d636b", "#7fe8ff"] }],
    material: "metal",
    damage: 2,
    speed: 0.7 * FIGURE_SCALE
}


export interface Construct extends Monster
{
    kind: ConstructKind
    /** where it flies to */
    destX: number
    destZ: number
    /** has somewhere to fly to */
    going: boolean
    /** seconds it holds still */
    wait: number
    /** seconds until it looks around again */
    lookWait: number
    /** seconds into its zip, which goes on while zipping, and how many it takes */
    zipping: boolean
    zipTime: number
    zipDuration: number
    /** where the zip started and where it ends */
    fromX: number
    fromZ: number
    toX: number
    toZ: number
    /** of length 1, where the zip goes */
    dirX: number
    dirZ: number
    /** random offset for showing it apart from the others */
    phase: number
}

/**
 * Returns how far along a zip is after the given share of its time
 */
export function zipEase(t: number): number
{
    return t * t * t * t * t
}

/**
 * Returns the seconds a zip of the given length in world units takes
 */
export function zipDuration(length: number): number
{
    return Math.max(ZIP_TIME, 5 * length / MAX_ZIP_SPEED)
}


/**
 * The constructs of a level, metal cages around a glowing core. They fly straight from point to point, and once they see a
 * hero they zip through them to as far behind them, which is the only thing about them that hurts.
 */
export default class ConstructPack extends MonsterPack<Construct>
{
    /** heroes a zip went through in the last update, with the construct that did it */
    private readonly hits = new Map<Prey, Construct>()

    add(kind: ConstructKind, face: number, x: number, z: number): Construct
    {
        const construct: Construct = {
            kind,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            flash: 0,
            shoveX: 0,
            shoveZ: 0,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            destX: x,
            destZ: z,
            going: false,
            wait: rng.next(PAUSE_MIN, PAUSE_MAX),
            lookWait: rng.next() * LOOK_TIME,
            zipping: false,
            zipTime: 0,
            zipDuration: ZIP_TIME,
            fromX: x,
            fromZ: z,
            toX: x,
            toZ: z,
            dirX: 0,
            dirZ: 1,
            phase: rng.next() * TAU
        }
        this.members.push(construct)
        return construct
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        this.hits.clear()
        for (const construct of this.members)
        {
            construct.flash = Math.max(0, construct.flash - delta)
            construct.chase = Math.max(0, construct.chase - delta)
            construct.yaw = (construct.yaw + (construct.zipping ? ZIP_SPIN : SPIN) * delta) % TAU
            if (construct.zipping)
            {
                this.zip(construct, delta, heroes)
                continue
            }
            if (construct.wait > 0)
            {
                construct.wait -= delta
                continue
            }
            construct.lookWait -= delta
            if (construct.lookWait <= 0)
            {
                construct.lookWait = LOOK_TIME
                this.decide(construct, heroes)
            }
            if (!construct.zipping)
            {
                this.fly(construct, delta)
            }
        }
    }

    /**
     * A zip that went through a hero hurts them, unless they are dodging. A shield in about the right direction stops it and
     * throws the construct back.
     */
    touch(hero: Prey, open: boolean): number
    {
        const construct = this.hits.get(hero)
        if (!construct)
        {
            return 0
        }
        if (hero.blocking && -(construct.dirX * Math.sin(hero.facing) + construct.dirZ * Math.cos(hero.facing)) >= Math.cos(BLOCK_ANGLE))
        {
            this.hits.delete(hero)
            this.endZip(construct, RECOVER_TIME)
            construct.shoveX = -construct.dirX * RECOIL_SPEED
            construct.shoveZ = -construct.dirZ * RECOIL_SPEED
            return 0
        }
        return open ? construct.kind.damage : 0
    }

    /**
     * A blow stops a zip
     */
    protected struck(construct: Construct): void
    {
        this.endZip(construct, STAGGER_TIME)
        construct.going = false
    }

    /**
     * Has a construct look around: it zips through a hero it sees, flies to where it last saw one, or else on to another
     * point
     */
    private decide(construct: Construct, heroes: readonly Prey[]): void
    {
        const prey = this.closestSeen(construct, heroes)
        if (prey)
        {
            construct.chase = CHASE_TIME
            construct.goalX = prey.x
            construct.goalZ = prey.z
            if (this.startZip(construct, prey))
            {
                return
            }
        }
        if (construct.chase > 0)
        {
            construct.destX = construct.goalX
            construct.destZ = construct.goalZ
            construct.going = true
        }
        else if (!construct.going)
        {
            const angle = rng.next() * TAU, length = rng.next(WANDER_MIN, WANDER_MAX)
            const x = construct.x + Math.sin(angle) * length, z = construct.z + Math.cos(angle) * length
            if (this.floor.sees(construct.x, construct.z, x, z))
            {
                construct.destX = x
                construct.destZ = z
                construct.going = true
            }
        }
    }

    /**
     * Has a construct zip through a hero, to as far behind them as it is in front, or less if a wall is in the way
     *
     * @return whether there is room for it
     */
    private startZip(construct: Construct, hero: Prey): boolean
    {
        const dx = hero.x - construct.x, dz = hero.z - construct.z
        const distance = Math.hypot(dx, dz)
        if (distance < 1e-6)
        {
            return false
        }
        const dirX = dx / distance, dirZ = dz / distance
        for (let behind = Math.max(distance, MIN_BEHIND); behind >= MIN_BEHIND; behind *= BEHIND_SHRINK)
        {
            const toX = hero.x + dirX * behind, toZ = hero.z + dirZ * behind
            if (this.floor.sees(construct.x, construct.z, toX, toZ))
            {
                Object.assign(construct, {
                    zipping: true,
                    passing: true,
                    zipTime: 0,
                    zipDuration: zipDuration(distance + behind),
                    fromX: construct.x,
                    fromZ: construct.z,
                    toX,
                    toZ,
                    dirX,
                    dirZ,
                    going: false,
                    shoveX: 0,
                    shoveZ: 0
                })
                return true
            }
        }
        return false
    }

    /**
     * Has a construct go on with its zip, and notes whom it goes through
     */
    private zip(construct: Construct, delta: number, heroes: readonly Prey[]): void
    {
        construct.zipTime += delta
        const t = Math.min(1, construct.zipTime / construct.zipDuration)
        const along = zipEase(t)
        const x0 = construct.x, z0 = construct.z
        const wantX = construct.fromX + (construct.toX - construct.fromX) * along - x0
        const wantZ = construct.fromZ + (construct.toZ - construct.fromZ) * along - z0
        this.floor.move(construct, wantX, wantZ)
        const reach = construct.kind.radius + HERO_RADIUS
        for (const hero of heroes)
        {
            if (!this.hits.has(hero) && segmentDistance(hero.x, hero.z, x0, z0, construct.x, construct.z) < reach)
            {
                this.hits.set(hero, construct)
            }
        }
        const wanted = Math.hypot(wantX, wantZ)
        const stuck = wanted > 1e-4 && Math.hypot(construct.x - x0, construct.z - z0) < wanted * 0.5
        if (t >= 1 || stuck)
        {
            this.endZip(construct, RECOVER_TIME)
        }
    }

    private endZip(construct: Construct, wait: number): void
    {
        construct.zipping = false
        construct.passing = false
        construct.wait = wait
        // looks around right after
        construct.lookWait = 0
    }

    /**
     * Has a construct fly straight to where it is going, and hold still a while once it is there
     */
    private fly(construct: Construct, delta: number): void
    {
        if (!construct.going)
        {
            return
        }
        const dx = construct.destX - construct.x, dz = construct.destZ - construct.z
        const distance = Math.hypot(dx, dz)
        const step = construct.kind.speed * delta
        const share = distance > step ? step / distance : 1
        const x0 = construct.x, z0 = construct.z
        this.floor.move(construct, dx * share, dz * share)
        const moved = Math.hypot(construct.x - x0, construct.z - z0)
        // there, or up against a wall
        if (share === 1 || moved < step * 0.5)
        {
            construct.going = false
            construct.wait = rng.next(PAUSE_MIN, PAUSE_MAX)
        }
    }
}
