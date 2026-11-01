import Prando from "prando";
import type { Face, FaceType } from "./geometry";


export function clamp(v: number): number
{
    return v < 0 ? 0 : v > 1 ? 1 : v;
}


/**
 * Creates a random seed to create a Prando instance, since we're about to create prando, we don't use it but the
 * non-reproducible normal js random
 *
 * @return {number}
 */
export function randomSeed(override: number | null = null): number
{
    const seed = Math.round(typeof override === "number" ? override : Math.random() * 0xffffffff)
    console.log("SEED", seed)
    return seed
}


export let rng = new Prando(randomSeed() )

export function resetRandom(seed: number): void
{
    rng = new Prando(seed)
}

/**
 * Mixes the world seed with the patch position, so every patch gets its own reproducible random sequence.
 */
export function patchSeed(seed: number, q: number, r: number): number
{
    let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
    h = Math.imul(h ^ q, 0xc2b2ae35)
    h = Math.imul(h ^ (h >>> 16) ^ r, 0x27d4eb2f)
    return (h ^ (h >>> 15)) >>> 0
}

export function countNeighbors(face: Face, predicate: (face: Face) => boolean): number
{
    const first = face.halfEdge;
    let curr = first;

    let count = 0
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && predicate(twin.face))
        {
            count++
        }
        curr = next
    }  while (curr !== first)

    return count
}


export function countNeighborsOfType(face: Face, type: FaceType): number
{
    const first = face.halfEdge;
    let curr = first;

    let count = 0
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && twin.face.type === type)
        {
            count++
        }
        curr = next
    }  while (curr !== first)

    return count
}


export function countNeighborsInSet(face: Face, set: Set<Face>): number
{
    const first = face.halfEdge;
    let curr = first;

    let count = 0
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && set.has(twin.face))
        {
            count++
        }
        curr = next
    }  while (curr !== first)

    return count
}

export function countNeighborsNotInSet(face: Face, set: Set<Face>): number
{
    const first = face.halfEdge;
    let curr = first;

    let count = 0
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && !set.has(twin.face))
        {
            count++
        }
        curr = next
    }  while (curr !== first)

    return count
}

/**
 * Returns true if the given face connects to the given other face
 *
 * @param face      face
 * @param other     other face
 */
export function connectsTo(face : Face, other : Face)
{
    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const {twin} = curr
        if (twin && twin.face === other)
        {
            return true;
        }
        curr = next
    } while (curr !== first)

    return false;
}

export type WeightedChoice<T> = [weight : number, value : T | (() => T)]

/**
 * Returns a random choice from an array of weighted choices. Each weighted choice contains a number which expresses
 * its weight compared the other options and then either a value or a function returning a value.
 *
 * @param choices   Array of weighted choices
 *
 * @template T  value type shared by all weighted choices
 */
export function weightedRandom<T>(choices : WeightedChoice<T>[]) : (rnd? : number) => T
{
    let sum = 0;

    for (const [weight] of choices)
    {
        sum += weight;
    }

    const resolve = (value : T | (() => T)) : T => typeof value === "function" ? (value as () => T)() : value;

    return (rnd = rng.next()) => {

        let val = rnd * sum;

        const last = choices.length - 1;
        for (let i = 0; i < last; i++)
        {
            const [weight, value] = choices[i];

            val -= weight;
            if (val <= 0)
            {
                return resolve(value);
            }
        }

        return resolve(choices[last][1]);
    }
}
