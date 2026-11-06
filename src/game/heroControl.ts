/**
 * Fastest a hero moves on orders, as a multiple of walking on their own
 */
export const RUN_SPEED = 2.5

/**
 * How long a dash lasts in seconds, how fast it goes as a multiple of running, and the seconds from its start until the
 * next one can start
 */
export const DASH_TIME = 0.16
export const DASH_SPEED = 3.5
export const DASH_COOLDOWN = 0.55

/**
 * How fast someone moves behind their shield as a share of running
 */
export const BLOCK_SPEED = 0.45

/**
 * What a hero is told to do at one moment, with the directions in world units
 */
export interface HeroOrders
{
    /** where to go, up to length 1 for going at full speed */
    moveX: number
    moveZ: number
    /** where to look, any length, none without */
    aimX: number
    aimZ: number
    dash: boolean
    attack: boolean
    block: boolean
}

export const NO_ORDERS: HeroOrders = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, dash: false, attack: false, block: false }


/**
 * Turns the orders a hero gets from moment to moment into what they do. Plain state without the scene, which applies the
 * outcome: dashes run for their time and wait for the next one, attacks wait for the one before, and a tapped attack that
 * doesn't fit right now comes as soon as it can.
 */
export default class HeroControl
{
    /** movement as a multiple of walking speed */
    velocityX = 0
    velocityZ = 0
    /** where to turn to as a meeple facing, null to leave that alone */
    turnTo: number | null = null
    blocking = false

    private dashLeft = 0
    private dashWait = 0
    private dashX = 0
    private dashZ = 0
    private dashHeld = false

    private attackWait = 0
    private attackHeld = false
    private attackQueued = false

    /**
     * @param attackTime    seconds an attack takes until the next one, null if the hero has nothing to attack with
     * @param canBlock      whether the hero has something to block with
     */
    constructor(private readonly attackTime: number | null, private readonly canBlock: boolean)
    {
    }

    get dashing(): boolean
    {
        return this.dashLeft > 0
    }

    get moving(): boolean
    {
        return this.velocityX !== 0 || this.velocityZ !== 0
    }

    /**
     * Moves on by a frame
     *
     * @param orders    what the hero is told to do now
     * @param delta     seconds since the last call
     * @param facing    where the hero looks now, as a meeple facing, which a dash goes to without a direction to go in
     *
     * @return true if the hero attacks right now
     */
    update({ moveX, moveZ, aimX, aimZ, dash, attack, block }: HeroOrders, delta: number, facing: number): boolean
    {
        this.dashLeft = Math.max(0, this.dashLeft - delta)
        this.dashWait = Math.max(0, this.dashWait - delta)
        this.attackWait = Math.max(0, this.attackWait - delta)

        const moved = moveX !== 0 || moveZ !== 0
        if (dash && !this.dashHeld && this.dashWait === 0)
        {
            const length = Math.hypot(moveX, moveZ)
            this.dashX = moved ? moveX / length : Math.sin(facing)
            this.dashZ = moved ? moveZ / length : Math.cos(facing)
            this.dashLeft = DASH_TIME
            this.dashWait = DASH_COOLDOWN
        }
        this.dashHeld = dash

        const { dashing } = this
        this.blocking = block && this.canBlock && !dashing

        const speed = RUN_SPEED * (dashing ? DASH_SPEED : this.blocking ? BLOCK_SPEED : 1)
        this.velocityX = (dashing ? this.dashX : moveX) * speed
        this.velocityZ = (dashing ? this.dashZ : moveZ) * speed

        if (aimX !== 0 || aimZ !== 0)
        {
            this.turnTo = Math.atan2(aimX, aimZ)
        }
        else if (dashing || moved)
        {
            this.turnTo = Math.atan2(this.velocityX, this.velocityZ)
        }
        else
        {
            this.turnTo = null
        }

        return this.updateAttack(attack)
    }

    private updateAttack(attack: boolean): boolean
    {
        const { attackTime } = this
        if (attackTime === null)
        {
            return false
        }
        // raising the shield drops what was tapped before
        this.attackQueued = !this.blocking && (this.attackQueued || attack && !this.attackHeld)
        this.attackHeld = attack
        if (this.dashing || this.blocking || this.attackWait > 0 || !attack && !this.attackQueued)
        {
            return false
        }
        this.attackQueued = false
        this.attackWait = attackTime
        return true
    }
}
