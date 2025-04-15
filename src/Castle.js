import { rng } from "./util"
import { FaceType } from "./geometry"
import Vector from "./vector"


function ringSet(content)
{
    let set = new Set()

    if (Array.isArray(content))
    {
        for (let i = 0; i < content.length; i++)
        {
            const element = content[i]
            set.add(element)
        }
    }
    else
    {
        set.add(content)
    }
    return set
}

/**
 * Returns a new ring (set of faces) from the given previous ring
 * @param ring  ring to extend
 * @param all   set of all faces currently in the all rings
 * @return {undefined}
 */
function extendRing(ring,all)
{

    const outer = new Set()

    for (let face of ring)
    {
        const first = face.halfEdge
        let curr = first
        do
        {
            const next = curr.next
            // const x0 = 0 | (cx + curr.vertex.x)
            // const y0 = 0 | (cy + curr.vertex.y)
            // const x1 = 0 | (cx + next.vertex.x)
            // const y1 = 0 | (cy + next.vertex.y)
            //
            // const x2 = 0 | ((x0 + x1) / 2 - cx)
            // const y2 = 0 | ((y0 + y1) / 2 - cy)
            //
            const {twin} = curr
            if (!twin)
            {
                // we reached the outer limits.
                outer.clear()
                return outer
            }
            const { face } = twin
            if (!all.has(face))
            {
                all.add(face)
                outer.add(face)
            }
            curr = next
        } while (curr !== first)
    }
    return outer
}

function findInRings(rings, f)
{
    for (let i = 0; i < rings.length; i++)
    {
        const ring = rings[i]
        if (ring.has(f))
        {
            return i;
        }
    }
    return -1
}

const OUTSIDE = [
    FaceType.GRASS,
    FaceType.DIRT,
    FaceType.ROCK,
    FaceType.TREE,
    FaceType.TREE2,
    FaceType.SAND
]

export function randomConnections(must = 0)
{
    if ((must & 15) === 15)
    {
        return 15;
    }

    // all 16 bit cases where at least 2 bits are set
    while(true)
    {
        const mask = rng.nextInt(3,15)

        if (mask === 4 || mask === 8)
        {
            continue;
        }

        if ((mask & must) === must)
        {
            return mask;
        }
    }
}


function constructRoad(face, dir)
{
    while (face && !touchesBorder(face))
    {
        const oldType = face.type
        face.type = oldType === FaceType.WALL ? FaceType.GATE : FaceType.PAVED

        let [posX,posY] = face.centroid

        posX += dir.x * 100
        posY += dir.y * 100

        face = chooseNext(face, f => {

            const [x, y] = f.centroid

            const dx = posX - x
            const dy = posY - y

            return Math.sqrt(dx * dx + dy * dy)
        })

        //console.log("FACE", face)
    }
    face.type = FaceType.PAVED
}

function touchesBorder(face)
{
    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (!twin)
        {
            return true
        }
        curr = next
    } while (curr !== first)
    return false
}

export function HIGHEST(a,b)
{
    return b[1]-a[1]
}

export function LOWEST(a,b)
{
    return a[1]-b[1]
}

function chooseNext(face, evaluator, order = LOWEST)
{
    const values = []
    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            values.push([twin.face,evaluator(twin.face)])
        }
        curr = next
    } while (curr !== first)

    if (!values.length)
    {
        return null
    }
    values.sort(order)
    //console.log("RANK", values)

    return values[0][0]
}


export function getNeighbors(face,start = null)
{
    let out = []
    const first = face.halfEdge
    let curr = first

    let startIndex = -1
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            if (start && start === twin.face)
            {
                startIndex = out.length
            }
            out.push(twin.face)
        }
        curr = next
    } while (curr !== first)

    if (start)
    {
        out = out.slice(startIndex).concat(out.slice(0,startIndex))
    }
    return out
}

export function filterNeighbors(face,type)
{
    let out = []
    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin && twin.face.type === type)
        {
            out.push(twin.face)
        }
        curr = next
    } while (curr !== first)
    return out
}


function buildMarket(center)
{
    center.type = FaceType.MARKET

    const first = center.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            twin.face.type = FaceType.MARKET

            const neighbors = getNeighbors(twin.face,center)
            neighbors[1].type = FaceType.MARKET
            neighbors[3].type = FaceType.MARKET

        }
        curr = next
    } while (curr !== first)
}

function countFreeNeighbors(face, considerPlotsOccupied = true)
{
    let count = 0
    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            if(twin.face.type === FaceType.PLOT)
            {
                if (!considerPlotsOccupied)
                {
                    //console.log("PLOT IS FREE")
                    count++
                }
            }
            else if (!twin.face.type.occupied)
            {
                //console.log(twin.face.type.name, " IS FREE")
                count++
            }
        }
        curr = next
    } while (curr !== first)

    return count
}


const DECO = [FaceType.GRASS, FaceType.TREE, FaceType.GRASS, FaceType.TREE2, FaceType.GRASS]
const TREES = [FaceType.TREE, FaceType.TREE2]


function followWall(face, all, segnent)
{
    if (face.type === FaceType.WALL)
    {
        all.add(face)
        segnent.push(face)
    }

    const first = face.halfEdge
    let curr = first
    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            if (twin.face.type === FaceType.WALL && !all.has(twin.face))
            {
                followWall(twin.face, all, segnent)
            }
        }
        curr = next
    } while (curr !== first)

    return segnent
}


function buildWallSegments(faces, wallFaces)
{
    const all = new Set()

    const segments = []

    for (let i = 0; i < wallFaces.length; i++)
    {
        const wallFace = wallFaces[i]
        if (!all.has(wallFace) && wallFace.type === FaceType.WALL)
        {
            const s = followWall(wallFace, all, [])
            if (s.length)
            {
                segments.push(s)
            }
        }
    }

    return segments
}


function getOuterPointsOfSegment(segment)
{
    const out = []
    for (let i = 0; i < segment.length; i++)
    {
        const face = segment[i]

        const first = face.halfEdge
        let curr = first

        do
        {
            const next = curr.next
            const {twin} = curr
            if (!twin || twin.type !== FaceType.WALL)
            {
                out.push(
                    curr.vertex,
                    next.vertex
                )
            }
            curr = next
        } while (curr !== first)
    }

    console.log("OUTER", segment,out)

    return out
}


function anyMatch(a, b)
{
    for (let i = 0; i < a.length; i++)
    {
        const vertexA = a[i]
        for (let j = 0; j < b.length; j++)
        {
            const vertexB = b[j]
            if (vertexA.x === vertexB.x && vertexA.y === vertexB.y)
            {
                return true
            }
        }
    }
    return false
}


function mergeSegments(segments)
{
    const allOuterPoints = segments.map(getOuterPointsOfSegment)

    const replacements = new Map()

    for (let i = 0; i < allOuterPoints.length; i++)
    {
        const a = allOuterPoints[i]

        for (let j = allOuterPoints.length - 1; j > i; j--)
        {
            const b = allOuterPoints[j]
            if (anyMatch(a,b))
            {
                replacements.set(j,i)
            }
        }
    }

    if (replacements.size > 0)
    {
        console.log("MERGES", replacements)
        const out = []
        for (let i = 0; i < segments.length; i++)
        {
            const segment = segments[i]

            let r,e = i
            while (e = replacements.get(e))
            {
                r = e
            }
            if (r)
            {
                out[r] = out[r].concat(segment)
                out[i] = null
            }
            else
            {
                out[i] = segment
            }
        }

        return out.filter(e => e !== null)
    }

    return segments
}


export default class Castle
{
    segments = []

    /**
     *
     * @type {Face}
     */
    centerFace = null

    constructor(faces)
    {
        const byDist = faces.sort((a,b) => {
            const [x0,y0] = a.centroid
            const [x1,y1] = b.centroid
            return Math.sqrt(x0 * x0 + y0 * y0) - Math.sqrt(x1 * x1 + y1 * y1);
        })

        const center = byDist[0]

        this.centerFace = center
        
        const ring0 = ringSet(center)

        let rings = [ring0]

        let prev = ring0
        let r
        const all = new Set()

        while ((r = extendRing(prev, all)) && r.size > 0)
        {
            //console.log("RING", r)

            rings.push(r)
            prev = r
        }

        const castle = rings.slice(0,-2)

        const wall = castle[castle.length - 1].union(castle[castle.length - 2])
        const moat = Array.from(rings[rings.length - 1].union(rings[rings.length - 2]));

        const castleSize = castle.reduce((a,b) => a + b.size, 0)
        const usable = castleSize - wall.size

        faces.forEach( face => {
            const ring = findInRings(castle, face)
            if (ring >= 0 && all.has(face))
            {
                // inside the castle
                if (ring < castle.length - 2)
                {
                    // every second pair of rings we have a 66% of building plot
                    if (((ring >> 1) & 1) !== 0)
                    {
                        let n = rng.next()
                        face.type = n < 0.66 ? (n < 0.15 ? FaceType.HOUSE : FaceType.PLOT) : FaceType.DIRT
                    }
                }
                else
                {
                    // our outer two rings are wall
                    face.type = FaceType.WALL
                }
            }
        })

        moat.forEach(f => f.type = FaceType.GRASS)

        const c = randomConnections()
        if ((c & 1) !== 0)
        {
            console.log("ROAD NORTH")
            const dir = new Vector(0,-1)
            constructRoad(center, dir)
        }
        if ((c & 2) !== 0)
        {
            console.log("ROAD EAST")
            const dir = new Vector(1,0)
            constructRoad(center, dir)
        }
        if ((c & 4) !== 0)
        {
            console.log("ROAD SOUTH")
            const dir = new Vector(0,1)
            constructRoad(center, dir)
        }
        if ((c & 8) !== 0)
        {
            console.log("ROAD WEST")
            const dir = new Vector(-1,0)
            constructRoad(center, dir)
        }

        buildMarket(center)

        for (let i = 0; i < castle.length; i++)
        {
            const ring = castle[i]
            for(let face of ring)
            {
                if (face.type === FaceType.DIRT)
                {
                    let free = countFreeNeighbors(face)
                    if (free === 1 || (free === 2 && getNeighbors(face).find(f => countFreeNeighbors(f) === 4)))
                    {
                        face.type = rng.nextArrayItem(DECO)
                    }
                    else if (free === 4 && rng.next() < 0.333)
                    {
                        face.type = rng.nextArrayItem(TREES)
                    }
                }
            }
        }

        this.segments = mergeSegments(buildWallSegments(faces, Array.from(wall)))

        //center.type = FaceType.SAND
    }
}
