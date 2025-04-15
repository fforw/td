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
        twin.next = new HalfEdge(twin.next, vertex, edge, he.face)

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

    const habv = new HalfEdge(hvca, hab.vertex, hvca.edge, fa);
    const hbcv = new HalfEdge(hvab, hbc.vertex, hvab.edge, fb);
    const hcav = new HalfEdge(hvbc, hca.vertex, hvbc.edge, fc);

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

    const habv = new HalfEdge(hvda, hab.vertex, hvcd.edge, fa);
    const hbcv = new HalfEdge(hvab, hbc.vertex, hvab.edge, fb);
    const hcdv = new HalfEdge(hvbc, hcd.vertex, hvbc.edge, fc);
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

function quickFix(faces)
{
    // XXX: we still have odd double points and this removes them until I find out my

    const map = new Map()

    const key = vertex => Math.round(vertex.x) + ":" + Math.round(vertex.y)

    let count = 0;
    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i];
        const first = face.halfEdge;
        let curr = first;
        do
        {
            const { vertex } = curr;
            const k = key(vertex);
            const existing = map.get(k);
            if (existing)
            {
                count++;
                curr.vertex = existing
                curr.vertex.halfEdge = curr
            }
            else
            {

                map.set(k, vertex)
            }

            curr = curr.next
        }  while (curr !== first)

    }

    console.log("Quick-fixed #" + count + " vertices")

}

function pixelatePositions(faces)
{
    // XXX: we still have odd double points and this removes them until I find out my

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

    const neighbors = (r & 1) ? oddNeighbors : evenNeighbors

    // connect hexagon to preexisting hexagons
    for (let i = 0; i < neighbors.length; i++)
    {
        const [qOff, rOff] = neighbors[i];

        const faceIndex = patch.getHexagon(q + qOff,r + rOff)
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


export const PATCH_SIZE = 10;
const hSize = PATCH_SIZE/2;

export default class HexagonPatch
{
    q = 0
    r = 0

    static SIZE = PATCH_SIZE

    hexagons = new Map()

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

        const edges = [...findInsideEdges(faces)]
        shuffle(edges)

        const count = 0 | (edges.length * 0.7)
        for (let i = 0; i < count; i++)
        {
            const edge = edges[i];
            removeEdge(faces, edge)
        }

        faces = divideIntoQuads(faces)
        quickFix(faces)
        relax(faces)
        pixelatePositions(faces)
        faces.forEach(validateFace)

        validateFaces(faces)
        return faces;
    }
}
