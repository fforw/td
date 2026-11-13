import type { Corridor } from "../map/dungeonCorridors"

/**
 * Hops at which a sound from another space can't be heard anymore
 */
export const SILENT_HOPS = 4

/**
 * Gain for each hop between the space of a sound and the listener
 */
const HOP_GAIN = 0.35

/**
 * Lowpass cutoff in Hz of a sound in the listener's space, and what each hop multiplies it by
 */
const OPEN_CUTOFF = 18000
const HOP_CUTOFF = 0.25

/**
 * A doorway between two spaces, at the middle between the faces on either side
 */
export interface Doorway
{
    /** spaces on either side */
    a: number
    b: number
    x: number
    z: number
}

/**
 * How a sound in a space is heard from the listener's space
 */
export interface Heard
{
    /** doorways between the spaces, Infinity if there is no way */
    hops: number
    /** doorway the sound enters the listener's space through, null within it and without a way */
    entry: Doorway | null
}

/**
 * The rooms and corridors of a level as spaces sound travels between, through their doorways. Rooms come first with
 * their indexes, then the corridors that have faces of their own. A corridor without faces is just a doorway between
 * the spaces at its ends.
 */
export default class SoundSpaces
{
    /** space each floor face belongs to */
    private readonly spaceOf = new Map<number, number>()
    /** doorways of each space */
    private readonly doorwaysOf: Doorway[][] = []
    readonly doorways: Doorway[] = []
    readonly count: number

    /**
     * @param rooms     global face ids per room
     * @param corridors corridors between the rooms
     * @param center    center of a global face in world units
     */
    constructor(
        rooms: readonly (readonly number[])[],
        corridors: readonly Pick<Corridor, "faces" | "fromFace" | "toFace">[],
        center: (face: number) => readonly [number, number]
    )
    {
        rooms.forEach((faces, room) => faces.forEach(face => this.spaceOf.set(face, room)))
        let count = rooms.length
        for (const { faces } of corridors)
        {
            if (faces.length)
            {
                const space = count++
                for (const face of faces)
                {
                    this.spaceOf.set(face, space)
                }
            }
        }
        this.count = count
        for (let space = 0; space < count; space++)
        {
            this.doorwaysOf.push([])
        }

        for (const { faces, fromFace, toFace } of corridors)
        {
            if (faces.length)
            {
                this.addDoorway(fromFace, faces[0], center)
                this.addDoorway(faces[faces.length - 1], toFace, center)
            }
            else
            {
                this.addDoorway(fromFace, toFace, center)
            }
        }
    }

    private addDoorway(face: number, other: number, center: (face: number) => readonly [number, number]): void
    {
        const a = this.spaceOf.get(face)
        const b = this.spaceOf.get(other)
        if (a === undefined || b === undefined || a === b)
        {
            return
        }
        const [ax, az] = center(face)
        const [bx, bz] = center(other)
        const doorway: Doorway = { a, b, x: (ax + bx) / 2, z: (az + bz) / 2 }
        this.doorways.push(doorway)
        this.doorwaysOf[a].push(doorway)
        this.doorwaysOf[b].push(doorway)
    }

    /**
     * Returns the space of a floor face, null for a face outside of them
     */
    space(face: number): number | null
    {
        return this.spaceOf.get(face) ?? null
    }

    /**
     * Returns how the sound of every space is heard from the given one, by index of the space
     */
    hear(listener: number): Heard[]
    {
        const heard: Heard[] = Array.from({ length: this.count }, () => ({ hops: Infinity, entry: null }))
        heard[listener].hops = 0
        const open = [listener]
        for (let i = 0; i < open.length; i++)
        {
            const space = open[i]
            const { hops, entry } = heard[space]
            for (const doorway of this.doorwaysOf[space])
            {
                const next = doorway.a === space ? doorway.b : doorway.a
                if (heard[next].hops === Infinity)
                {
                    heard[next].hops = hops + 1
                    heard[next].entry = entry ?? doorway
                    open.push(next)
                }
            }
        }
        return heard
    }
}


/**
 * Returns the gain of a sound the given hops away, 0 at SILENT_HOPS and beyond
 */
export function hopGain(hops: number): number
{
    return hops < SILENT_HOPS ? HOP_GAIN ** hops : 0
}


/**
 * Returns the lowpass cutoff in Hz of a sound the given hops away, which muffles it more with every doorway
 */
export function hopCutoff(hops: number): number
{
    return OPEN_CUTOFF * HOP_CUTOFF ** Math.min(hops, SILENT_HOPS)
}
