import {
    BORDER_DIR,
    BORDER_FIRST,
    BORDER_NQ,
    BORDER_NR,
    BORDER_Q,
    BORDER_R,
    BORDER_SECOND,
    BORDER_STRIDE,
    next,
    type QuadPatch
} from "./QuadPatch"

/**
 * Global half edge, face and vertex ids hold the slot of their patch in the upper bits. Since the lower 16 bits of a
 * global half edge id are a multiple of 4 per face, global face ids are just global half edge ids shifted by two, like
 * the local ones.
 */
export const SLOT_SHIFT = 16
export const LOCAL_MASK = (1 << SLOT_SHIFT) - 1


function borderKey(q: number, r: number, dir: number): string
{
    return q + "/" + r + "/" + dir
}


/**
 * Loaded patch with the state that changes while the patch is loaded
 */
interface Slot
{
    patch: QuadPatch

    /**
     * Global id of the twin half edge in a neighboring patch per seam index, -1 while that neighbor isn't connected
     */
    seamTwin: Int32Array

    /**
     * Border entry index by border key
     */
    borderIndex: Map<string, number>
}


/**
 * Set of loaded packed patches that are connected along their shared borders. The geometry of patches is immutable,
 * connecting and disconnecting only changes the seam twins kept here.
 */
export default class PatchWorld
{
    private slots: (Slot | null)[] = []

    /**
     * Adds a patch and connects it to all loaded neighbors.
     *
     * @param patch     packed patch
     *
     * @return slot of the patch
     */
    add(patch: QuadPatch): number
    {
        const { border } = patch
        const entries = border.length / BORDER_STRIDE

        const borderIndex = new Map<string, number>()
        for (let i = 0; i < entries; i++)
        {
            const off = i * BORDER_STRIDE
            borderIndex.set(borderKey(border[off + BORDER_Q], border[off + BORDER_R], border[off + BORDER_DIR]), i)
        }

        let slot = this.slots.indexOf(null)
        if (slot < 0)
        {
            slot = this.slots.length
        }
        this.slots[slot] = { patch, seamTwin: new Int32Array(entries * 2).fill(-1), borderIndex }

        for (let other = 0; other < this.slots.length; other++)
        {
            if (other !== slot && this.slots[other])
            {
                this.connect(slot, other)
            }
        }
        return slot
    }


    /**
     * Disconnects the patch in the given slot from its neighbors and frees the slot.
     *
     * @param slot      slot
     */
    remove(slot: number): void
    {
        this.neighbors(slot).forEach(other => this.disconnect(slot, other))
        this.slots[slot] = null
    }


    /**
     * Returns the slots of all patches connected to the patch in the given slot
     */
    neighbors(slot: number): number[]
    {
        const { seamTwin } = this.getSlot(slot)
        const neighbors = new Set<number>()
        for (let i = 0; i < seamTwin.length; i++)
        {
            if (seamTwin[i] >= 0)
            {
                neighbors.add(seamTwin[i] >> SLOT_SHIFT)
            }
        }
        return [...neighbors]
    }


    getPatch(slot: number): QuadPatch
    {
        return this.getSlot(slot).patch
    }


    /**
     * Returns the slot of the patch with the given position or -1 if no such patch is loaded
     */
    findSlot(q: number, r: number): number
    {
        return this.slots.findIndex(s => s !== null && s.patch.q === q && s.patch.r === r)
    }


    private getSlot(slot: number): Slot
    {
        const s = this.slots[slot]
        if (!s)
        {
            throw new Error("No patch in slot " + slot)
        }
        return s
    }


    /**
     * Connects the patches in the given slots along their shared border.
     *
     * @return number of hexagon edges connected, 0 if the patches don't touch
     */
    connect(slotA: number, slotB: number): number
    {
        const a = this.getSlot(slotA)
        const b = this.getSlot(slotB)
        const { border } = a.patch
        const baseA = slotA << SLOT_SHIFT
        const baseB = slotB << SLOT_SHIFT

        let count = 0
        for (let i = 0, off = 0; off < border.length; i++, off += BORDER_STRIDE)
        {
            const j = b.borderIndex.get(borderKey(border[off + BORDER_NQ], border[off + BORDER_NR], (border[off + BORDER_DIR] + 3) % 6))
            if (j !== undefined)
            {
                const offB = j * BORDER_STRIDE
                const a0 = border[off + BORDER_FIRST]
                const a1 = border[off + BORDER_SECOND]
                const b0 = b.patch.border[offB + BORDER_FIRST]
                const b1 = b.patch.border[offB + BORDER_SECOND]

                if (__DEV)
                {
                    // a0 runs from c0 to m, a1 from m to c1, b0 from c1 to m and b1 from m to c0
                    if (!samePosition(a.patch, a0, b.patch, next(b1)) || !samePosition(a.patch, a1, b.patch, b1))
                    {
                        throw new Error("Seam vertices don't match")
                    }
                }

                // like HexagonPatch.connect(): a0 twins with b1 and a1 with b0
                a.seamTwin[i * 2] = baseB | b1
                a.seamTwin[i * 2 + 1] = baseB | b0
                b.seamTwin[j * 2] = baseA | a1
                b.seamTwin[j * 2 + 1] = baseA | a0
                count++
            }
        }
        return count
    }


    /**
     * Separates the patches in the given slots again.
     */
    disconnect(slotA: number, slotB: number): void
    {
        clearSeams(this.getSlot(slotA).seamTwin, slotB)
        clearSeams(this.getSlot(slotB).seamTwin, slotA)
    }


    /**
     * Returns the global id of the twin of the given global half edge, possibly in a neighboring patch, or -1 if the
     * half edge is on an unconnected border.
     */
    twin(h: number): number
    {
        const slot = h >> SLOT_SHIFT
        const { patch, seamTwin } = this.getSlot(slot)
        const t = patch.twin[h & LOCAL_MASK]
        return t >= 0 ? (slot << SLOT_SHIFT) | t : seamTwin[-2 - t]
    }


    /**
     * Returns the FaceType index of the face with the given global id
     */
    faceType(face: number): number
    {
        const slot = face >> (SLOT_SHIFT - 2)
        return this.getSlot(slot).patch.faceType[face & (LOCAL_MASK >> 2)]
    }


    /**
     * Returns the EdgeType index for crossing the given global half edge from its own face
     */
    edgeType(h: number): number
    {
        return this.getSlot(h >> SLOT_SHIFT).patch.edgeType[h & LOCAL_MASK]
    }


    /**
     * Sets the type of the edge of the given global half edge. A neighbor that isn't connected keeps its side of a
     * seam, it has to get the type when it is loaded.
     *
     * @param h         global half edge
     * @param type      EdgeType index
     * @param oneWay    only change crossing in the direction of the given half edge, not the way back
     */
    setEdgeType(h: number, type: number, oneWay = false): void
    {
        this.getSlot(h >> SLOT_SHIFT).patch.edgeType[h & LOCAL_MASK] = type

        const twin = this.twin(h)
        if (!oneWay && twin >= 0)
        {
            this.getSlot(twin >> SLOT_SHIFT).patch.edgeType[twin & LOCAL_MASK] = type
        }
    }


    /**
     * Writes the start position of the given global half edge into out[offset..offset + 2]
     */
    position(h: number, out: { [i: number]: number }, offset = 0): void
    {
        const { patch } = this.getSlot(h >> SLOT_SHIFT)
        const v = patch.vertex[h & LOCAL_MASK] * 3
        out[offset] = patch.positions[v]
        out[offset + 1] = patch.positions[v + 1]
        out[offset + 2] = patch.positions[v + 2]
    }
}


function samePosition(a: QuadPatch, ha: number, b: QuadPatch, hb: number): boolean
{
    const va = a.vertex[ha] * 3
    const vb = b.vertex[hb] * 3
    return a.positions[va] === b.positions[vb] && a.positions[va + 1] === b.positions[vb + 1]
}


function clearSeams(seamTwin: Int32Array, slot: number): void
{
    for (let i = 0; i < seamTwin.length; i++)
    {
        if (seamTwin[i] >= 0 && seamTwin[i] >> SLOT_SHIFT === slot)
        {
            seamTwin[i] = -1
        }
    }
}
