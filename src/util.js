import Prando from "prando";


export function clamp(v)
{
    return v < 0 ? 0 : v > 1 ? 1 : v;
}


/**
 * Creates a random seed to create a Prando instance, since we're about to create prando, we don't use it but the
 * non-reproducible normal js random
 *
 * @return {number}
 */
export function randomSeed(override = null)
{
    const seed = Math.round(typeof override === "number" ? override : Math.random() * 0xffffffff)
    console.log("SEED", seed)
    return seed
}


export let rng = new Prando(randomSeed() )

export function resetRandom(seed)
{
    rng = new Prando(seed)
}

export function countNeighbors(face, predicate)
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


export function countNeighborsOfType(face, type)
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


export function countNeighborsInSet(face, set)
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

export function countNeighborsNotInSet(face, set)
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
