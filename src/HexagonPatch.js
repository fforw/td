import { Edge, Face, HalfEdge, Vertex } from "./geometry";
import { rng } from "./util";

function findInsideEdges(faces)
{
    const edges = new Set()

    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];

        const first = face.halfEdge;
        let curr = first;
        do
        {
            if (curr.twin)
            {
                edges.add(curr.edge)
            }

            curr = curr.next

        } while (curr !== first)
    }

    return edges;
}

function getEdges(faces)
{
    const edges = new Set()

    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];

        const first = face.halfEdge;
        let curr = first;
        do
        {
            if (!curr.edge)
            {
                throw new Error("No edge set")
            }

            edges.add(curr.edge)
            curr = curr.next

        } while (curr !== first)
    }

    return edges;
}


function shuffle(a) {
    let j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(rng.next() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}



function findFaceIndex(faces, other)
{
    if (!other)
    {
        throw new Error("Need face")
    }

    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];
        if (face === other)
        {
            return i
        }
    }
    return -1;
}


function resetFacesInLoop(prev, face)
{
    let curr = prev;
    do
    {
        curr.face = face
        curr = curr.next
    } while (curr !== prev)
}


function removeEdge(faces, edge)
{
    if (!edge || !edge.halfEdge || !edge.halfEdge.twin)
    {
        throw new Error("Need half edge and twin")
    }

    const he = edge.halfEdge;
    const face = he.face
    const other = he.twin.face
    if (face.length !== 3 || other.length !== 3)
    {
        return;
    }

    const index = findFaceIndex(faces, other)
    if (index < 0)
    {
        throw new Error("Did not find twin face in faces array")
    }
    faces.splice(index, 1)



    const prev = he.prev
    const twinPrev = he.twin.prev

    // the removed half edges might be what their vertices point to
    he.vertex.halfEdge = he.twin.next
    he.twin.vertex.halfEdge = he.next

    prev.next = he.twin.next
    twinPrev.next = he.next
    resetFacesInLoop(prev, face);

    if (face.halfEdge === he)
    {
        face.halfEdge = prev
    }
}


function subdivideEdge(he)
{
    const { twin } = he

    const vertex = new Vertex(
        (he.vertex.x + he.next.vertex.x) / 2,
        (he.vertex.y + he.next.vertex.y) / 2,
        (he.vertex.z + he.next.vertex.z) / 2,
        null
    )

    const edge = new Edge(null)
    const newEdge = new HalfEdge(he.next, vertex, edge, he.face);
    he.next = newEdge
    if (twin)
    {
        // he keeps the old edge together with the new twin half, twin moves to the new edge with newEdge
        twin.next = new HalfEdge(twin.next, vertex, he.edge, twin.face)
        twin.edge = edge

        he.twinWith(twin.next)
        twin.twinWith(newEdge)
    }

    return newEdge
}


function divideTriIntoQuads(faces, face)
{
    let ha = face.halfEdge
    let hab = face.halfEdge.next
    let hb = face.halfEdge.next.next
    let hbc = face.halfEdge.next.next.next
    let hc = face.halfEdge.next.next.next.next
    let hca = face.halfEdge.next.next.next.next.next


    const vertex = new Vertex(
        (ha.vertex.x + hb.vertex.x + hc.vertex.x) / 3,
        (ha.vertex.y + hb.vertex.y + hc.vertex.y) / 3,
        (ha.vertex.z + hb.vertex.z + hc.vertex.z) / 3,
        null
    )

    const fa = new Face(null);
    const fb = new Face(null);
    const fc = new Face(null);


    const hvca = new HalfEdge(hca, vertex, new Edge(null), fa);
    const hvab = new HalfEdge(hab, vertex, new Edge(null), fb);
    const hvbc = new HalfEdge(hbc, vertex, new Edge(null), fc);

    const habv = new HalfEdge(hvca, hab.vertex, hvab.edge, fa);
    const hbcv = new HalfEdge(hvab, hbc.vertex, hvbc.edge, fb);
    const hcav = new HalfEdge(hvbc, hca.vertex, hvca.edge, fc);

    hvab.twinWith(habv)
    hvbc.twinWith(hbcv)
    hvca.twinWith(hcav)

    hca.face = fa
    hab.face = fb
    hbc.face = fc

    ha.next = habv;
    hb.next = hbcv;
    hc.next = hcav;

    resetFacesInLoop(ha, fa);
    resetFacesInLoop(hb, fb);
    resetFacesInLoop(hc, fc);


    faces.push(fa,fb,fc)

}


function subdivideQuad(faces, face)
{

    let ha = face.halfEdge
    let hab = ha.next
    let hb = hab.next
    let hbc = hb.next
    let hc = hbc.next
    let hcd = hc.next
    let hd = hcd.next
    let hda = hd.next


    const vertex = new Vertex(
        (ha.vertex.x + hb.vertex.x + hc.vertex.x + hd.vertex.x) / 4,
        (ha.vertex.y + hb.vertex.y + hc.vertex.y + hd.vertex.y) / 4,
        (ha.vertex.z + hb.vertex.z + hc.vertex.z + hd.vertex.z) / 4,
        null
    )

    const fa = new Face(null);
    const fb = new Face(null);
    const fc = new Face(null);
    const fd = new Face(null);


    const hvab = new HalfEdge(hab, vertex, new Edge(null), fb);
    const hvbc = new HalfEdge(hbc, vertex, new Edge(null), fc);
    const hvcd = new HalfEdge(hcd, vertex, new Edge(null), fd);
    const hvda = new HalfEdge(hda, vertex, new Edge(null), fa);

    const habv = new HalfEdge(hvda, hab.vertex, hvab.edge, fa);
    const hbcv = new HalfEdge(hvab, hbc.vertex, hvbc.edge, fb);
    const hcdv = new HalfEdge(hvbc, hcd.vertex, hvcd.edge, fc);
    const hdav = new HalfEdge(hvcd, hda.vertex, hvda.edge, fd);

    hvab.twinWith(habv)
    hvbc.twinWith(hbcv)
    hvcd.twinWith(hcdv)
    hvda.twinWith(hdav)

    ha.next = habv;
    hb.next = hbcv;
    hc.next = hcdv;
    hd.next = hdav;

    resetFacesInLoop(ha, fa);
    resetFacesInLoop(hb, fb);
    resetFacesInLoop(hc, fc);
    resetFacesInLoop(hd, fd);

    faces.push(fa,fb,fc,fd)


}



function divideIntoQuads(faces)
{

    getEdges(faces).forEach(e => subdivideEdge(e.halfEdge))

    const newFaces = [];

    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];

        const { length } = face;

        if ( length === 6 )
        {
            divideTriIntoQuads(newFaces, face)
        }
        else if ( length === 8 )
        {
            subdivideQuad(newFaces, face)
        }
        else
        {
            throw new Error("Not tri or quad")
        }
    }

    return newFaces
}



function validateFace(face)
{
    const { halfEdge } = face
    if (!halfEdge)
    {
        throw new Error("No half edge: " + face)
    }
    const set = new Set();

    let curr = halfEdge;
    do
    {
        if (set.has(curr))
        {
            throw new Error("Duplicate on iteration: " + curr)
        }

        set.add(curr)

        const next = curr.next;
        if (!next)
        {
            throw new Error("Next not set: " + face)
        }
        curr = next
    } while (curr !== halfEdge)

}

function setToAverage(v)
{
    const { halfEdge : start } = v;

    if (!start)
    {
        return;
    }

    let x = 0;
    let y = 0;
    let z = 0;
    let count = 0;

    let curr = start;
    let twin
    let max = 20;
    do
    {
        x += curr.next.vertex.x
        y += curr.next.vertex.y
        z += curr.next.vertex.z
        count++

        twin = curr.twin;
        if (twin)
        {
            curr = twin.next
        }

    } while(twin && curr !== start && max-- > 0)


    // if (!twin)
    // {
    //     const prev = start.prev;
    //     let curr = prev;
    //     max = 10
    //     do
    //     {
    //         x += curr.next.vertex.x
    //         y += curr.next.vertex.y
    //         count++
    //
    //         twin = curr.twin;
    //         if (twin)
    //         {
    //             curr = twin.prev
    //         }
    //
    //     } while(twin && curr !== prev && max-- > 0)
    // }

    if (twin)
    {
        v.x = x/count
        v.y = y/count
        v.z = z/count

    }
}

function relax(faces)
{
    const set = new Set()
    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];
        let curr = face.halfEdge
        do
        {
            set.add(curr.vertex)
            curr = curr.next
        } while (curr !== face.halfEdge)
    }

    const verts = [... set]

    const relaxCount = 25
    for (let i=0; i < relaxCount; i++)
    {
        for (let j=0; j < verts.length; j++)
        {
            const v = verts[j]

            setToAverage(v)
        }
    }


    console.log("faces = ", faces.length, ", verts =", set.size)

}


function pDistance(x, y, x1, y1, x2, y2) {

    var A = x - x1;
    var B = y - y1;
    var C = x2 - x1;
    var D = y2 - y1;

    var dot = A * C + B * D;
    var len_sq = C * C + D * D;
    var param = -1;
    if (len_sq != 0) //in case of 0 length line
        param = dot / len_sq;

    var xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    }
    else if (param > 1) {
        xx = x2;
        yy = y2;
    }
    else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    var dx = x - xx;
    var dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}


function getMinimumDistanceToPoint(face, x0, y0)
{
    let min = Infinity
    let curr = face.halfEdge;
    do
    {
        const dist = pDistance(
            x0, y0,
            curr.vertex.x, curr.vertex.y,
            curr.next.vertex.x, curr.next.vertex.y,
        );

        if (dist < min)
        {
            min = dist
        }
        curr = curr.next
    } while (curr !== face.halfEdge)

    return min;
}

function pixelatePositions(faces)
{
    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];
        const first = face.halfEdge;
        let curr = first;
        do
        {
            const { vertex } = curr;

            vertex.x |= 0
            vertex.y |= 0
            vertex.z |= 0

            curr = curr.next
        }  while (curr !== first)

    }
}

function getSetOfIds(faces)
{
    const ids = new Set()
    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];
        ids.add(face.id)
    }
    return ids;
}


function validateFaces(faces)
{
    const ids = getSetOfIds(faces);

    for (let i = 0; i < faces.length; i++)
    {

        const face = faces[i];
        const first = face.halfEdge;
        let curr = first;
        do
        {
            const id = curr.face.id;
            if (!ids.has(id))
            {
                console.warn("Coming from Face #" + face.id + ": Face id #" + id + " of node #" + curr.id + " is not in the faces array")
            }

            curr = curr.next
        } while (curr !== first)

    }
}

/////////////////////////////////////////



const TAU = Math.PI * 2;
const sin60 = Math.sin(TAU / 6);

const hFactor = Math.sqrt(3);

const directions = [
    new Vertex(0,0, null),
    new Vertex(0,-1, null),
    new Vertex(sin60, -0.5, 0, null),
    new Vertex(sin60,  0.5, 0, null),
    new Vertex(0,1, null),
    new Vertex(-sin60, 0.5, 0, null),
    new Vertex(-sin60,  -0.5, 0, null),
]

const evenNeighbors = [
    [0,-1],
    [1,0],
    [0,1],
    [-1,1],
    [-1,0],
    [-1,-1]
]

const oddNeighbors = [
    [1,-1],
    [1,0],
    [1,1],
    [0,1],
    [-1,0],
    [0,-1]
]



export function createHexagon(q, r, faces, points, patch)
{
    const start = faces.length;
    patch.setHexagon(q,r, start)

    const w = hFactor * patch.size
    const hw = w * 0.5
    const h = patch.size * 2

    const offX = w * q + ((r & 1) !== 0 ? hw : 0)
    const offY = h * 0.75 * r


    const verts = directions.map(d => new Vertex(
        d.x * patch.size + offX,
        d.y * patch.size + offY,
        0,
        null,
    ).round());

    const neighbors = (r & 1) ? oddNeighbors : evenNeighbors
    const neighborFaces = neighbors.map(([qOff, rOff]) => patch.getHexagon(q + qOff, r + rOff))

    // Share the corner vertices with preexisting neighbors. The outer edge of face i runs from verts[i + 1] to
    // verts[i + 2], the matching face of the neighbor runs along the same edge in the opposite direction.
    for (let i = 0; i < neighbors.length; i++)
    {
        const faceIndex = neighborFaces[i]
        if (faceIndex !== undefined)
        {
            const he = faces[faceIndex + ((i + 3) % 6)].halfEdge
            verts[i + 1] = he.next.vertex
            verts[i === 5 ? 1 : i + 2] = he.vertex
        }
    }

    const v3 = verts[0];

    let prevFace
    let firstFace;
    const last = verts.length - 1;
    for (let i = 1; i < verts.length; i++)
    {
        const v = verts[i];
        const v2 = verts[i === last ? 1 : i + 1];

        const face = new Face(null);

        if (i === 1)
        {
            firstFace = face
        }

        const he0 = new HalfEdge(null, v, null, face)
        const he1 = new HalfEdge(null, v2, null, face)
        const he2 = new HalfEdge(null, v3, null, face)

        he0.next = he1
        he1.next = he2
        he2.next = he0

        he0.edge = new Edge(he0)
        he1.edge = i === last ? firstFace.halfEdge.next.next.edge : new Edge(he1)
        he2.edge = prevFace ? prevFace.halfEdge.next.edge : new Edge(he2)

        face.halfEdge = he0
        faces.push(
            face
        )

        if (prevFace)
        {
            prevFace.halfEdge.next.twinWith(face.halfEdge.next.next)
        }

        prevFace = face
    }

    const face = faces[start]

    prevFace.halfEdge.next.twinWith(face.halfEdge.next.next)

    points.push(... verts)

    // connect hexagon to preexisting hexagons
    for (let i = 0; i < neighbors.length; i++)
    {
        const faceIndex = neighborFaces[i]
        if (faceIndex !== undefined)
        {
            const he0 = faces[start + i].halfEdge
            const he1 = faces[faceIndex + ((i + 3) % 6)].halfEdge

            he1.twinWith(he0)
        }
    }
}



/////////////////////////////////////////

function key(q, r)
{
    return q + "/" + r
}

function borderKey(q, r, dir)
{
    return q + "/" + r + "/" + dir
}


/**
 * Returns all half edges going out of the vertex of the given half edge that are reachable over twins. That is the
 * whole ring for inner vertices or the chain between two border edges for border vertices.
 *
 * @param {HalfEdge} start  outgoing half edge
 *
 * @return {HalfEdge[]} outgoing half edges
 */
function getFan(start)
{
    const fan = [start]
    let curr = start
    while (curr.twin)
    {
        curr = curr.twin.next
        if (curr === start)
        {
            return fan
        }
        fan.push(curr)
    }

    // we hit the border, collect the rest in the other direction
    let prev = start.prev
    while (prev.twin)
    {
        curr = prev.twin
        fan.push(curr)
        prev = curr.prev
    }
    return fan
}


/**
 * Returns the border half edge following the given border half edge.
 *
 * @param {HalfEdge} he     border half edge
 *
 * @return {HalfEdge} next border half edge
 */
function nextOnBorder(he)
{
    let curr = he.next
    while (curr.twin)
    {
        curr = curr.twin.next
    }
    return curr
}


/**
 * Replaces the vertex "drop" with the vertex "keep" in all half edges going out of "drop"
 */
function mergeVertex(keep, drop)
{
    if (keep === drop)
    {
        return
    }

    if (__DEV)
    {
        if (keep.x !== drop.x || keep.y !== drop.y)
        {
            throw new Error("Seam vertices don't match: " + keep + ", " + drop)
        }
    }

    getFan(drop.halfEdge).forEach(he => he.vertex = keep)
}


/**
 * Gives every fan that the given outgoing half edges fall into after disconnecting its own vertex. The fan containing
 * vertex.halfEdge keeps the vertex, the others get copies.
 *
 * @param {Vertex} vertex       vertex
 * @param {HalfEdge[]} outgoing all half edges that went out of the vertex before disconnecting
 */
function splitVertex(vertex, outgoing)
{
    const remaining = new Set(outgoing)
    getFan(vertex.halfEdge).forEach(he => remaining.delete(he))

    while (remaining.size)
    {
        const [start] = remaining
        const copy = new Vertex(vertex.x, vertex.y, vertex.z, start)
        getFan(start).forEach(he => {
            he.vertex = copy
            remaining.delete(he)
        })
    }
}


function untwin(he, twin)
{
    he.twin = null
    twin.twin = null

    he.edge.halfEdge = he
    twin.edge = new Edge(twin)
}


export const PATCH_SIZE = 10;
const hSize = PATCH_SIZE/2;

export default class HexagonPatch
{
    q = 0
    r = 0

    static SIZE = PATCH_SIZE

    hexagons = new Map()

    /**
     * Outer hexagon edges of the patch, keyed by hexagon position and direction. Each entry holds the position of the
     * neighbor hexagon outside the patch and the two border half edges the edge got subdivided into.
     *
     * @type {Map<String, {dir: Number, nq: Number, nr: Number, first: HalfEdge, second: HalfEdge}>}
     */
    border = new Map()

    /**
     * Connected neighbor patches mapped to the seam half edges as flat list of twin pairs.
     *
     * @type {Map<HexagonPatch, HalfEdge[]>}
     */
    connections = new Map()

    constructor(q,r, size = 40)
    {
        this.q = q
        this.r = r
        this.size = size
    }


    /**
     * Returns the index of the first face in the hexagon at the coordinates q/r or undefined if no such hexagon exists
     * 
     * @param {Number} q    q-position
     * @param {Number} r    r-position
     * 
     * @return {Number} faceIndex
     */
    getHexagon(q,r)
    {
        return this.hexagons.get(key(q,r))
    }


    /**
     * Sets the face index for the hexagon at the coordinates q/r
     *
     * @param {Number} q            q-position
     * @param {Number} r            r-position
     * @param {Number} faceIndex    face index
     */
    setHexagon(q,r,faceIndex)
    {
        this.hexagons.set(key(q,r), faceIndex)
    }

    build()
    {
        let faces = [];
        const verts = []

        let hexCount = 0;
        for (let q = -hSize; q < hSize; q++)
        {
            for (let r = -hSize; r < hSize; r++)
            {
                createHexagon(this.q + q, this.r + r, faces, verts, this)
                hexCount++
            }
        }

        console.log("Created #" + hexCount + " hexagons")

        const borderEdges = this.findBorderEdges(faces)

        const edges = [...findInsideEdges(faces)]
        shuffle(edges)

        const count = 0 | (edges.length * 0.7)
        for (let i = 0; i < count; i++)
        {
            const edge = edges[i];
            removeEdge(faces, edge)
        }

        faces = divideIntoQuads(faces)

        // the original border half edges became the first half of the subdivided edge
        borderEdges.forEach(
            ({ q, r, dir, nq, nr, halfEdge }) => this.border.set(borderKey(q, r, dir), {
                dir,
                nq,
                nr,
                first: halfEdge,
                second: nextOnBorder(halfEdge)
            })
        )

        relax(faces)
        pixelatePositions(faces)
        faces.forEach(validateFace)

        validateFaces(faces)
        return faces;
    }


    /**
     * Collects the outer half edges of all hexagons whose neighbor lies outside of the patch. Must be called before
     * the faces are modified since it uses the face indexes of the hexagons.
     */
    findBorderEdges(faces)
    {
        const borderEdges = []
        for (let q = this.q - hSize; q < this.q + hSize; q++)
        {
            for (let r = this.r - hSize; r < this.r + hSize; r++)
            {
                const start = this.getHexagon(q, r)
                const neighbors = (r & 1) ? oddNeighbors : evenNeighbors
                for (let dir = 0; dir < neighbors.length; dir++)
                {
                    const [qOff, rOff] = neighbors[dir];
                    const nq = q + qOff
                    const nr = r + rOff
                    if (this.getHexagon(nq, nr) === undefined)
                    {
                        borderEdges.push({ q, r, dir, nq, nr, halfEdge: faces[start + dir].halfEdge })
                    }
                }
            }
        }
        return borderEdges
    }


    /**
     * Connects the mesh of this patch with the mesh of a neighboring patch along their shared border. The vertices of
     * the seam are merged and the border half edges become twins.
     *
     * @param {HexagonPatch} other  neighboring patch
     *
     * @return {Number} number of hexagon edges connected, 0 if the patches don't touch
     */
    connect(other)
    {
        if (other === this || this.connections.has(other))
        {
            return 0
        }

        const seam = []
        this.border.forEach(({ dir, nq, nr, first: a0, second: a1 }) => {

            const otherEdge = other.border.get(borderKey(nq, nr, (dir + 3) % 6))
            if (otherEdge)
            {
                // a0: c0 -> m, a1: m -> c1 and b0: c1 -> m, b1: m -> c0 on the other side
                const { first: b0, second: b1 } = otherEdge

                mergeVertex(a0.vertex, b1.next.vertex)
                mergeVertex(a1.vertex, b1.vertex)
                mergeVertex(a1.next.vertex, b0.vertex)

                a0.twinWith(b1)
                a1.twinWith(b0)

                seam.push(a0, b1, a1, b0)
            }
        })

        if (seam.length)
        {
            this.connections.set(other, seam)
            other.connections.set(this, seam)
        }

        return seam.length / 4
    }


    /**
     * Separates this patch from a connected neighbor again. Seam vertices still shared with other connected patches
     * stay merged.
     *
     * @param {HexagonPatch} other  connected patch
     */
    disconnect(other)
    {
        const seam = this.connections.get(other)
        if (!seam)
        {
            return
        }

        this.connections.delete(other)
        other.connections.delete(this)

        // collect the fans while the seam vertices are still connected
        const fans = new Map()
        for (let i = 0; i < seam.length; i++)
        {
            const { vertex } = seam[i]
            if (!fans.has(vertex))
            {
                fans.set(vertex, getFan(vertex.halfEdge))
            }
        }

        for (let i = 0; i < seam.length; i += 2)
        {
            untwin(seam[i], seam[i + 1])
        }

        fans.forEach((outgoing, vertex) => splitVertex(vertex, outgoing))
    }


    /**
     * Separates this patch from all connected neighbors so it no longer shares any half edges or vertices with them.
     */
    disconnectAll()
    {
        [...this.connections.keys()].forEach(other => this.disconnect(other))
    }
}
