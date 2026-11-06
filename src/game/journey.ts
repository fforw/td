import type { Journey } from "./campaign"

/*
 * How far along someone on a journey is. Days decide that, so a journey has no state of its own to save: each day of it
 * stands for an equal share of the way. Walk shows it, walking on in between. It only has to match the days for someone
 * being followed, anyone else is just seen leaving.
 */

/**
 * What is left of the way in map units that counts as having got somewhere
 */
const CLOSE_ENOUGH = 1e-3


/**
 * Returns the share of the way a journey has reached on the given day and the one it reaches with the next day
 *
 * @param journey   journey
 * @param day       current day
 *
 * @return shares of the way from 0 to 1
 */
export function dayMarks({ startDay, endDay }: Pick<Journey, "startDay" | "endDay">, day: number): [number, number]
{
    const days = endDay - startDay
    const passed = Math.max(0, Math.min(days, day - startDay))
    return [passed / days, Math.min(days, passed + 1) / days]
}


/**
 * Returns the given way walked the other way around
 *
 * @param way       x and y in map units for each point
 */
export function reverseWay(way: readonly number[]): number[]
{
    const reversed: number[] = []
    for (let i = way.length - 2; i >= 0; i -= 2)
    {
        reversed.push(way[i], way[i + 1])
    }
    return reversed
}


/**
 * Someone walking along a way
 */
export class Walk
{
    readonly way: readonly number[]

    /** in map units */
    readonly length: number

    /** in map units from the start of the way */
    private distance: number

    /** index into the way of the start of the current segment */
    private index = 0

    /** in map units from the start of the way to the start of the current segment */
    private walked = 0

    /**
     * @param way       x and y in map units for each point
     * @param share     share of the way to start at
     */
    constructor(way: readonly number[], share: number)
    {
        this.way = way
        let length = 0
        for (let i = 2; i < way.length; i += 2)
        {
            length += Math.hypot(way[i] - way[i - 2], way[i + 1] - way[i - 1])
        }
        this.length = length
        this.distance = length * share
        this.seek()
    }

    /**
     * Returns the share of the way walked
     */
    get share(): number
    {
        return this.length > 0 ? this.distance / this.length : 1
    }

    /**
     * Puts the walk at the given share of the way, also further back
     */
    jumpTo(share: number): void
    {
        this.distance = this.length * share
        this.index = 0
        this.walked = 0
        this.seek()
    }

    /**
     * Walks on, but only up to one mark
     *
     * @param step      distance to walk in map units
     * @param next      share of the way to stop at
     *
     * @return true if that took any walking
     */
    advance(step: number, next: number): boolean
    {
        const { distance, length } = this
        this.distance = Math.max(distance, Math.min(distance + step, next * length))
        this.seek()
        return this.distance > distance
    }

    /**
     * Returns whether the walk has got to the given share of the way
     */
    isAt(share: number): boolean
    {
        return this.distance >= share * this.length - CLOSE_ENOUGH
    }

    /**
     * Writes the current position in map units, then the direction walked in, to the given array
     */
    position(out: number[]): void
    {
        const { way, index, walked, distance } = this
        const x = way[index]
        const y = way[index + 1]
        const dx = (way[index + 2] ?? x) - x
        const dy = (way[index + 3] ?? y) - y
        const segment = Math.hypot(dx, dy)
        const t = segment > 0 ? (distance - walked) / segment : 0
        out[0] = x + dx * t
        out[1] = y + dy * t
        out[2] = dx
        out[3] = dy
    }

    /**
     * Finds the segment of the current distance
     */
    private seek(): void
    {
        const { way, distance } = this
        while (this.index + 4 < way.length)
        {
            const i = this.index
            const segment = Math.hypot(way[i + 2] - way[i], way[i + 3] - way[i + 1])
            if (this.walked + segment > distance)
            {
                break
            }
            this.walked += segment
            this.index += 2
        }
    }
}
