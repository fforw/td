import type { Face, FaceType } from "./geometry";


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
