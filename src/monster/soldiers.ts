import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { BLOCK_ANGLE } from "./eyes"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, type Prey, THREAT_RANGE, threatens, turnBetween, turnTo } from "./monsters"
import { condition, leaf, memory, type Memory, reactionTime, selector, sequence, skilled, Tree } from "./behavior"

const TAU = Math.PI * 2

/**
 * Seconds the attack takes, when in it the sword comes down, and until when the soldier turns after who it goes after, as in
 * the attack clip of the model
 */
export const SWING_TIME = 1.5
export const CUT_TIME = 15 / 24
export const AIM_TIME = 9 / 24

/**
 * Seconds it takes to raise the shield all the way and to lower it again, as in the block clip of the model
 */
export const RAISE_TIME = 0.5
export const LOWER_TIME = 0.5

/**
 * How far up the shield has to be to stop a blow, from 0 down to 1 all the way up
 */
export const SHIELD_UP = 0.6

/**
 * Width in radians of the arc in front of a soldier that its shield covers
 */
export const SHIELD_ARC = Math.PI * 0.75

/**
 * Seconds a soldier keeps its guard up after a swing, or after a blow, at least and at most
 */
export const GUARD_MIN = 1
export const GUARD_MAX = 2.5

/**
 * Width in radians of the arc in front of a soldier that the sword hits
 */
export const CUT_ARC = Math.PI * 0.5

/**
 * Share of its walking speed at which a soldier closes in behind its shield
 */
const GUARD_PACE = 0.4

/**
 * How fast a soldier turns, in radians per second
 */
const TURN_RATE = 4

/**
 * Seconds between looking around for a soldier with nobody to go after
 */
const LOOK_TIME = 0.25

/**
 * How likely a soldier with nobody to go after walks somewhere when it looks around, and how far in world units
 */
const WANDER_CHANCE = 0.03
const WANDER_LENGTH = 0.6 * FIGURE_SCALE

/**
 * How close a soldier comes to who it goes after, as a share of its reach
 */
const CLOSE_IN = 0.8


/**
 * Skill a soldier needs to flank a hero with others and swing together with them
 */
export const FLANK_SKILL = 0.3

/**
 * Skill a soldier flanking a hero needs to take cover when the hero faces it, which leaves the strike to the others
 */
export const COVER_SKILL = 0.5

/**
 * How far off its slot around a hero a soldier counts as in place, in radians, how far round it goes at a time while
 * circling, and the distance beyond its radius it circles at, out of reach of a sword
 */
export const SLOT_ANGLE_TOLERANCE = 0.35
const CIRCLE_ANGLE_STEP = 0.6
const CIRCLE_DISTANCE = THREAT_RANGE

/**
 * Seconds a soldier in place waits for the others to get there before it swings anyway, about as long as a quarter circle
 * around a hero takes
 */
export const CUE_WAIT_TIME = 3

export interface SoldierKind extends MonsterKind
{
    /** hit points the sword takes */
    damage: number
    /** walking speed in world units per second */
    speed: number
    /** how far the sword reaches from the middle of the soldier, in world units */
    reach: number
}

/**
 * Size of a soldier against its model, which is a bit small next to the heroes
 */
const SIZE = 1.15

export const SOLDIER: SoldierKind = {
    scale: SIZE,
    radius: 0.09 * SIZE * FIGURE_SCALE,
    mass: 1.2,
    hp: 8,
    big: true,
    flying: false,
    // the body, the shield on its left and the sword on its right
    burst: [
        { x: 0, y: 0.5, z: 0, rx: 0.2, ry: 0.5, rz: 0.17, colors: ["#a88788", "#a88788", "#4448a8"] },
        { x: 0.15, y: 0.33, z: 0.2, rx: 0.15, ry: 0.15, rz: 0.05, colors: ["#4c291e", "#4448a8"] },
        { x: -0.33, y: 0.78, z: 0, rx: 0.04, ry: 0.33, rz: 0.04, colors: ["#989bd9"] }
    ],
    material: "armor",
    damage: 3,
    speed: 0.55 * FIGURE_SCALE,
    reach: 0.25 * SIZE * FIGURE_SCALE
}


export interface Soldier extends Monster
{
    kind: SoldierKind
    memory: Memory
    /** how good it is at fighting, from 0 to 1 */
    skill: number
    /** walking somewhere with nobody to go after */
    wandering: boolean
    /** seconds into the current attack, null without one */
    attack: number | null
    /** the sword comes down in this frame */
    impact: boolean
    /** world units walked in all, which the walk clip follows */
    walked: number
    /** walked in this frame */
    moving: boolean
    /** seconds until it looks around again */
    lookWait: number
    /** raising the shield or holding it up, lowering it otherwise */
    guarding: boolean
    /** seconds until it lowers the shield again */
    guardLeft: number
    /** how far up the shield is, from 0 down to 1 all the way up */
    shield: number
    /** hero it goes after, null with nobody */
    target: Prey | null
    /** angle around its target it flanks them from, as a meeple facing from them, null if it doesn't flank */
    slotAngle: number | null
    /** at its slot and in reach */
    inPlace: boolean
    /** seconds it has been in place */
    inPlaceTime: number
    /** may swing, as all who flank its target with it are in place, or it waited long enough */
    onCue: boolean
    /** seconds a hero has threatened it in a row */
    threatTime: number
}


/**
 * The soldiers of a level: they walk after heroes, swing a sword that a shield stops, and then hold up their own for a
 * while, which stops blows from the front. Blows from the side or behind get through, as do those while it swings.
 */
export default class SoldierPack extends MonsterPack<Soldier>
{
    /**
     * @param skill     how good it is at fighting, from 0 to 1
     */
    add(kind: SoldierKind, face: number, x: number, z: number, skill = 0): Soldier
    {
        const soldier: Soldier = {
            kind,
            memory: memory(),
            skill,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            wandering: false,
            attack: null,
            impact: false,
            walked: 0,
            moving: false,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            lookWait: rng.next() * LOOK_TIME,
            guarding: false,
            guardLeft: 0,
            shield: 0,
            target: null,
            slotAngle: null,
            inPlace: false,
            inPlaceTime: 0,
            onCue: false,
            threatTime: 0,
            flash: 0,
            shoveX: 0,
            shoveZ: 0
        }
        this.members.push(soldier)
        return soldier
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        const { members } = this
        const seen = members.map(soldier =>
        {
            soldier.flash = Math.max(0, soldier.flash - delta)
            soldier.chase = Math.max(0, soldier.chase - delta)
            soldier.impact = false
            soldier.moving = false

            const prey = this.closestSeen(soldier, heroes)
            if (prey)
            {
                soldier.chase = CHASE_TIME
                soldier.goalX = prey.x
                soldier.goalZ = prey.z
                soldier.wandering = false
                soldier.target = prey
            }
            else if (soldier.chase === 0)
            {
                soldier.target = null
            }
            soldier.threatTime = prey && threatens(prey, soldier) ? soldier.threatTime + delta : 0
            return prey
        })
        this.assignSlots(heroes, delta)

        for (let i = 0; i < members.length; i++)
        {
            const soldier = members[i]
            SOLDIER_TREE.tick(soldier, { pack: this, prey: seen[i], delta })

            soldier.shield = soldier.guarding
                ? Math.min(1, soldier.shield + delta / RAISE_TIME)
                : Math.max(0, soldier.shield - delta / LOWER_TIME)
        }
    }

    /**
     * Only the sword hurts, in the frame it comes down, unless the shield of the hero stops it
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = 0
        for (const soldier of this.members)
        {
            if (open && soldier.impact && this.cutHits(soldier, hero) && !this.heroBlocks(hero, soldier))
            {
                damage = Math.max(damage, soldier.kind.damage)
            }
        }
        return damage
    }

    /**
     * Takes cover behind its shield, unless it is in the middle of a swing
     */
    protected struck(soldier: Soldier): void
    {
        if (soldier.attack === null)
        {
            this.raiseGuard(soldier)
        }
    }

    /**
     * A shield far enough up stops blows from the front
     */
    protected stops({ yaw, shield }: Soldier, dx: number, dz: number): boolean
    {
        return shield >= SHIELD_UP && Math.abs(turnBetween(yaw, Math.atan2(-dx, -dz))) <= SHIELD_ARC / 2
    }

    /**
     * Returns whether the sword of a soldier reaches a hero
     */
    cutHits({ kind, x, z, yaw }: Soldier, hero: Prey): boolean
    {
        const dx = hero.x - x, dz = hero.z - z
        const distance = Math.hypot(dx, dz)
        if (distance > kind.reach + HERO_RADIUS || !this.floor.sees(x, z, hero.x, hero.z))
        {
            return false
        }
        // right on top of it, the direction means little
        return distance < kind.radius + HERO_RADIUS || Math.abs(turnBetween(yaw, Math.atan2(dx, dz))) <= CUT_ARC / 2
    }

    /**
     * Returns whether a hero holds their shield up against a soldier in front of them
     */
    private heroBlocks(hero: Prey, { x, z }: Soldier): boolean
    {
        const dx = x - hero.x, dz = z - hero.z
        const distance = Math.hypot(dx, dz)
        return hero.blocking && (distance < 1e-6 || dx * Math.sin(hero.facing) + dz * Math.cos(hero.facing) >= Math.cos(BLOCK_ANGLE) * distance)
    }

    /**
     * Spreads the skilled soldiers that go after the same hero evenly around them, opposite each other for two. They take
     * the slots in the order they are around the hero, so nobody crosses over, and the slots are turned so that they all go
     * about as far. They get their cue to swing once all are in place, or after waiting a while.
     *
     * @param delta     seconds since the last frame
     */
    private assignSlots(heroes: readonly Prey[], delta: number): void
    {
        for (const soldier of this.members)
        {
            soldier.slotAngle = null
        }
        for (const hero of heroes)
        {
            const flankers = this.members.filter(({ target, chase, skill }) => target === hero && chase > 0 && skill >= FLANK_SKILL)
            if (flankers.length < 2)
            {
                continue
            }
            const angleOf = ({ x, z, goalX, goalZ }: Soldier) => Math.atan2(x - goalX, z - goalZ)
            const first = angleOf(flankers[0])
            const around = (soldier: Soldier) => (angleOf(soldier) - first + 2 * TAU) % TAU
            flankers.sort((a, b) => around(a) - around(b))
            const slotStep = TAU / flankers.length
            // the mean of where each is against its slot
            let sin = 0, cos = 0
            flankers.forEach((soldier, i) =>
            {
                sin += Math.sin(angleOf(soldier) - i * slotStep)
                cos += Math.cos(angleOf(soldier) - i * slotStep)
            })
            const base = Math.atan2(sin, cos)
            flankers.forEach((soldier, i) =>
            {
                soldier.slotAngle = base + i * slotStep
            })
        }
        for (const soldier of this.members)
        {
            const { slotAngle, x, z, goalX, goalZ, kind } = soldier
            soldier.inPlace = slotAngle !== null && Math.hypot(goalX - x, goalZ - z) <= kind.reach &&
                Math.abs(turnBetween(Math.atan2(x - goalX, z - goalZ), slotAngle)) <= SLOT_ANGLE_TOLERANCE
            soldier.inPlaceTime = soldier.inPlace ? soldier.inPlaceTime + delta : 0
        }
        for (const soldier of this.members)
        {
            const { target, slotAngle, inPlaceTime } = soldier
            soldier.onCue = slotAngle === null || inPlaceTime >= CUE_WAIT_TIME ||
                this.members.every(other => other.target !== target || other.slotAngle === null || other.inPlace)
        }
    }

    raiseGuard(soldier: Soldier): void
    {
        soldier.guarding = true
        soldier.guardLeft = rng.next(GUARD_MIN, GUARD_MAX)
        soldier.wandering = false
    }

    /**
     * Has a soldier go on with its swing, and raise the shield after it
     *
     * @param delta     seconds since the last frame
     */
    swing(soldier: Soldier, delta: number): void
    {
        const before = soldier.attack!
        const now = before + delta
        if (before < AIM_TIME && soldier.chase > 0)
        {
            turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        }
        soldier.impact = before < CUT_TIME && now >= CUT_TIME
        if (now < SWING_TIME)
        {
            soldier.attack = now
        }
        else
        {
            soldier.attack = null
            this.raiseGuard(soldier)
        }
    }

    /**
     * Has a soldier behind its shield face who it goes after and close in slowly, until it lowers the shield again
     *
     * @param delta     seconds since the last frame
     */
    guard(soldier: Soldier, delta: number): void
    {
        soldier.guardLeft -= delta
        if (soldier.guardLeft <= 0)
        {
            soldier.guarding = false
        }
        if (soldier.chase > 0)
        {
            turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
            this.walk(soldier, soldier.goalX, soldier.goalZ, soldier.kind.speed * GUARD_PACE * delta, soldier.kind.reach * CLOSE_IN)
        }
    }

    /**
     * With nobody to go after, has a soldier look around now and then, and walk somewhere sometimes
     *
     * @param delta     seconds since the last frame
     */
    wander(soldier: Soldier, delta: number): void
    {
        if (!soldier.wandering)
        {
            soldier.lookWait -= delta
            if (soldier.lookWait > 0)
            {
                return
            }
            soldier.lookWait = LOOK_TIME
            if (rng.next() < WANDER_CHANCE)
            {
                const angle = rng.next() * TAU
                soldier.goalX = soldier.x + Math.sin(angle) * WANDER_LENGTH
                soldier.goalZ = soldier.z + Math.cos(angle) * WANDER_LENGTH
                soldier.wandering = true
            }
            return
        }
        if (Math.hypot(soldier.goalX - soldier.x, soldier.goalZ - soldier.z) <= 0.01)
        {
            soldier.wandering = false
            return
        }
        turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        const step = soldier.kind.speed * delta
        // a wall in the way ends a walk about
        if (this.walk(soldier, soldier.goalX, soldier.goalZ, step, 0.01) < step / 2)
        {
            soldier.wandering = false
        }
    }

    /**
     * Walks a soldier after who it saw last, up to a bit within reach
     *
     * @param delta     seconds since the last frame
     */
    approach(soldier: Soldier, delta: number): void
    {
        const stopDistance = soldier.kind.reach * CLOSE_IN
        if (Math.hypot(soldier.goalX - soldier.x, soldier.goalZ - soldier.z) <= stopDistance)
        {
            return
        }
        turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        this.walk(soldier, soldier.goalX, soldier.goalZ, soldier.kind.speed * delta, stopDistance)
    }

    /**
     * Has a soldier circle the hero it goes after, facing them, out of reach of their sword until it is about at its slot,
     * and then step in to it
     *
     * @param delta     seconds since the last frame
     */
    flank(soldier: Soldier, delta: number): void
    {
        const { goalX, goalZ, kind } = soldier
        const slotAngle = soldier.slotAngle!
        turnTo(soldier, goalX, goalZ, TURN_RATE * delta)
        const angle = Math.atan2(soldier.x - goalX, soldier.z - goalZ)
        const turn = turnBetween(angle, slotAngle)
        const step = kind.speed * delta
        if (Math.abs(turn) <= SLOT_ANGLE_TOLERANCE)
        {
            const standDistance = kind.reach * CLOSE_IN
            this.walk(soldier, goalX + Math.sin(slotAngle) * standDistance, goalZ + Math.cos(slotAngle) * standDistance, step, 0)
            return
        }
        const circleDistance = Math.max(Math.hypot(soldier.x - goalX, soldier.z - goalZ), CIRCLE_DISTANCE + kind.radius)
        const toward = angle + Math.sign(turn) * Math.min(Math.abs(turn), CIRCLE_ANGLE_STEP)
        this.walk(soldier, goalX + Math.sin(toward) * circleDistance, goalZ + Math.cos(toward) * circleDistance, step, 0)
    }

    /**
     * Walks a soldier towards a point by at most the given step, stopping the given distance short of it
     *
     * @return world units it moved
     */
    private walk(soldier: Soldier, x: number, z: number, step: number, stopDistance: number): number
    {
        const dx = x - soldier.x, dz = z - soldier.z
        const distance = Math.hypot(dx, dz)
        if (distance <= stopDistance)
        {
            return 0
        }
        const length = Math.min(step, distance - stopDistance)
        const fromX = soldier.x, fromZ = soldier.z
        this.floor.move(soldier, dx / distance * length, dz / distance * length)
        const moved = Math.hypot(soldier.x - fromX, soldier.z - fromZ)
        soldier.walked += moved
        soldier.moving = moved > 0
        return moved
    }
}


/**
 * What the soldier tree gets each frame
 */
interface SoldierContext
{
    pack: SoldierPack
    /** closest hero in sight */
    prey: Prey | null
    /** seconds since the last frame */
    delta: number
}

/**
 * Raises the shield, and has it see the next blow coming anew
 */
const cover = leaf<Soldier, SoldierContext>("cover", {
    tick: (soldier, { pack }) =>
    {
        pack.raiseGuard(soldier)
        soldier.threatTime = 0
        return "success"
    }
})

const guard = leaf<Soldier, SoldierContext>("guard", {
    tick: (soldier, { pack, delta }) =>
    {
        pack.guard(soldier, delta)
        return "running"
    }
})

/**
 * Committed, so it goes through with the swing even when struck
 */
const swing = leaf<Soldier, SoldierContext>("swing", {
    commits: true,
    start: soldier =>
    {
        soldier.attack = 0
        return true
    },
    tick: (soldier, { pack, delta }) =>
    {
        pack.swing(soldier, delta)
        return soldier.attack === null ? "success" : "running"
    }
})

/**
 * Faces who it goes after while the shield comes down
 */
const hold = leaf<Soldier, SoldierContext>("hold", {
    tick: (soldier, { delta }) =>
    {
        turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        return "running"
    }
})

const flank = leaf<Soldier, SoldierContext>("flank", {
    tick: (soldier, { pack, delta }) =>
    {
        pack.flank(soldier, delta)
        return "running"
    }
})

const approach = leaf<Soldier, SoldierContext>("approach", {
    tick: (soldier, { pack, delta }) =>
    {
        pack.approach(soldier, delta)
        return "running"
    }
})

const wander = leaf<Soldier, SoldierContext>("wander", {
    tick: (soldier, { pack, delta }) =>
    {
        pack.wander(soldier, delta)
        return "running"
    }
})

/**
 * Soldiers guard for a while after each swing and when struck, go after heroes they saw and swing at them once in reach
 * with the shield down, and wander about otherwise. Skilled ones going after the same hero flank them from all sides and
 * swing together, and better ones take cover from the hero that faces them, while the others strike. Alone they don't, as
 * they would never strike.
 */
export const SOLDIER_TREE = new Tree<Soldier, SoldierContext>(selector("soldier",
    sequence("take cover",
        skilled(COVER_SKILL),
        condition("has a partner", ({ slotAngle }) => slotAngle !== null),
        condition("not guarding", ({ guarding }) => !guarding),
        condition("threatened", ({ threatTime, skill }) => threatTime >= reactionTime(skill, COVER_SKILL)),
        cover
    ),
    sequence("guard", condition("guarding", ({ guarding }) => guarding), guard),
    sequence("fight",
        condition("hunting", ({ chase }) => chase > 0),
        selector("strike or close in",
            sequence("strike",
                condition("in reach", ({ x, z, goalX, goalZ, kind }, { prey }) =>
                    prey !== null && Math.hypot(goalX - x, goalZ - z) <= kind.reach),
                condition("in place", ({ slotAngle, inPlace }) => slotAngle === null || inPlace),
                selector("swing or wait",
                    sequence("cut",
                        condition("shield down", ({ shield }) => shield === 0),
                        condition("on cue", ({ onCue }) => onCue),
                        swing
                    ),
                    hold
                )
            ),
            sequence("flanking", skilled(FLANK_SKILL), condition("has a slot", ({ slotAngle }) => slotAngle !== null), flank),
            approach
        )
    ),
    wander
))
