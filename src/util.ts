import Prando from "prando";
import type { Face, FaceType } from "./geometry";
import {Color, Group} from "three";
import marchingSquares from "./marchingSquares";


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

