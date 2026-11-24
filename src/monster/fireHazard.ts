import type { FireLine, FireRoom } from "../map/fireRoom"
import type FireRain from "./fireRain"

/**
 * Seconds from one time a line strikes to the next, from one line to the one after it, and from one strike of a line to the
 * next. A line takes the time to strike all along it, so it can be dodged on either side.
 */
export const HAZARD_PERIOD = 2.4
const LINE_DELAY = 0.4
const STRIKE_DELAY = 0.035

/**
 * Hit points a strike takes
 */
const HAZARD_DAMAGE = 1

/**
 * How close to a door in world units a hero has to get for the fire to start before they are in the room
 */
const NEAR_DOOR = 2.5


/**
 * Has fire come down along the lines of a fire room, over and over, while someone is there to see it
 */
export default class FireHazard
{
    on = true

    private clock = 0

    /**
     * @param room      the room
     * @param faces     its faces
     * @param rain      fire of the hazard alone
     */
    constructor(private readonly room: FireRoom, private readonly faces: ReadonlySet<number>, private readonly rain: FireRain)
    {
    }

    /**
     * Stops it for good. What hasn't started to fall yet doesn't come down anymore.
     */
    switchOff(): void
    {
        this.on = false
        this.rain.cancel()
    }

    /**
     * @param delta     seconds since the last call
     * @param heroes    where the heroes are
     */
    update(delta: number, heroes: readonly { face: number, x: number, z: number }[]): void
    {
        const { faces, room, rain } = this
        rain.update(delta)
        if (!this.on || !heroes.some(({ face, x, z }) =>
            faces.has(face) || room.doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < NEAR_DOOR)))
        {
            return
        }
        const from = this.clock
        const to = from + delta
        this.clock = to
        room.lines.forEach((line, index) => {
            const delay = index * LINE_DELAY % HAZARD_PERIOD
            // number of times it has gone off so far
            const before = Math.ceil((from - delay) / HAZARD_PERIOD)
            const after = Math.ceil((to - delay) / HAZARD_PERIOD)
            if (after > before)
            {
                this.strike(line, index % 2 === 1)
            }
        })
    }

    private strike({ x, z, strikes }: FireLine, backwards: boolean): void
    {
        const spots = strikes.map((strike, i) => ({ ...strike, delay: (backwards ? strikes.length - 1 - i : i) * STRIKE_DELAY }))
        this.rain.cast(spots, x, z, HAZARD_DAMAGE)
    }
}
