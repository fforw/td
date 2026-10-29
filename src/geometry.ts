import {rng} from "./util";

let vertexCounter = 1000;

/**
 * x/y/z coordinates as array
 */
export type Point = [number, number, number]

export class Vertex
{
    /**
     * X coordinate
     */
    x: number;
    /**
     * Y coordinate
     */
    y: number;

    /**
     * Z coordinate
     */
    z: number;

    /**
     * Outgoing half edge, set by the first HalfEdge created for the vertex
     */
    halfEdge: HalfEdge;

    id: number;

    constructor(x: number, y: number, z: number, halfEdge: HalfEdge | null)
    {
        this.x = x;
        this.y = y;
        this.z = z;

        this.halfEdge = halfEdge!;
        this.id = vertexCounter++;
    }

    round()
    {
        this.x |= 0
        this.y |= 0
        this.z |= 0

        return this
    }

    toString()
    {
        return "#" + this.id + ": " + (this.x) + "/" + (this.y)// + "/" + this.z
    }


}


export class Edge
{

    /**
     * One of the two half edges of the edge.
     */
    halfEdge: HalfEdge;
    constructor(halfEdge: HalfEdge | null)
    {
        this.halfEdge = halfEdge!;
    }

}
let faceCounter = 0;

const _faceTypeNames: string[] = [];

interface FaceTypeOptions
{
    color?: string
    terrain?: number
    occupied?: boolean
}

export class FaceType
{
    name = ""

    color = "#fff"
    terrain = 1
    occupied = false

    constructor(opts: FaceTypeOptions)
    {
        const { color, terrain, occupied } = opts;

        if (color)
        {
            this.color = color
        }
        if (typeof terrain === "number")
        {
            this.terrain = terrain
        }
        if (occupied)
        {
            this.occupied = true
        }
    }

    static DIRT = new FaceType({ color: "#4e320f", })
    static PAVED = new FaceType({ color: "#3a3a3a", })
    static GRASS = new FaceType({ color: "#099330", })
    static SAND = new FaceType({ color: "#aaa25d", })
    static WATER = new FaceType({ color: "#0a0e2b", occupied: true })
    static ROCK = new FaceType({ color: "#212144", occupied: true })
    static FOREST_FLOOR = new FaceType({ color: "#231f15", occupied: true})
    static TREE = new FaceType({ color: "#237127", occupied: true })
    static TREE2 = new FaceType({ color: "#004e24", occupied: true })
    static WALL = new FaceType({ color: "#212121", occupied: true })
    static GATE = new FaceType({ color: "#213333"})
    static MARKET = new FaceType({ color: "#555"})
    static PLOT = new FaceType({ color: "#552755", })
    static HOUSE = new FaceType({ color: "#ab2c79", occupied: true })

    static typeNames(): string[]
    {
        return _faceTypeNames
    }

    

}

// INITIALIZE FACE TYPE NAMES
for (const [name, ft] of Object.entries(FaceType))
{
    if (ft instanceof FaceType)
    {
        ft.name = name
        _faceTypeNames.push(name)
    }
}

//console.log("OCCUPIED", _faceTypeNames.filter(n => FaceType[n].occupied))

const DEFAULT_TYPES = [
    FaceType.DIRT,
    FaceType.GRASS,
    FaceType.TREE,
    FaceType.TREE2
]

export class Face
{
    id = 0
    /**
     * First half edge of the face interior, part of a closed loop back to the fist edge.
     */
    halfEdge: HalfEdge;

    /**
     * Type of the data
     */
    type: FaceType = rng.nextArrayItem(DEFAULT_TYPES);

    /**
     * Type dependent user data
     */
    data: unknown = null
    
    constructor(halfEdge: HalfEdge | null)
    {
        this.halfEdge = halfEdge!;
        this.id = faceCounter++;

    }
    get length(): number
    {
        const start = this.halfEdge;
        let curr = start;
        let count = 0;
        do
        {
            curr = curr.next
            count++;
        } while (curr !== start)
        return count;
    }


    /**
     * Returns the face centroid
     */
    get centroid(): Point
    {
        let x = 0;
        let y = 0;
        let z = 0;
        let count = 0;

        const first = this.halfEdge
        let curr = first
        do
        {
            x += curr.vertex.x;
            y += curr.vertex.y;
            z += curr.vertex.z;
            curr = curr.next
            count++;

        } while (curr !== first)

        return [x / count, y / count, z/count];
    }
}

let counter = 0;

/**
 * Central class of the half edge data structure
 */
export class HalfEdge
{
    /**
     * Next halfEdge in the face
     */
    next: HalfEdge;

    /**
     * Twin halfEdge from another face
     */
    twin: HalfEdge | null = null;
    /**
     * Vertex of this half edge
     */
    vertex: Vertex;

    /**
     * The edge the half edge belongs to
     */
    edge: Edge;

    /**
     * The face the half edge belongs to
     */
    face: Face;

    id: number;


    constructor(next: HalfEdge | null, vertex: Vertex, edge: Edge | null, face: Face)
    {
        this.next = next!;
        this.twin = null;
        this.vertex = vertex;
        this.edge = edge!;
        this.face = face;

        if (vertex && !vertex.halfEdge)
        {
            vertex.halfEdge = this;
        }

        if (edge && !edge.halfEdge)
        {
            edge.halfEdge = this;
        }

        if (face && !face.halfEdge)
        {
            face.halfEdge = this;
        }

        this.id = counter++

    }


    twinWith(other: HalfEdge): void
    {
        if (__DEV)
        {
            let { vertex : v0 } = this
            let { vertex : v1 } = this.next
            let { vertex : v2 } = other
            let { vertex : v3 } = other.next

            // Twins must share the actual vertex objects. Reassigning vertices here would only fix these two half
            // edges and leave the other half edges around the vertex pointing to a duplicate.
            if (v0 !== v3 || v1 !== v2)
            {
                throw new Error("Half edge vertices not shared " + this + ": " + v0 + ", " + v1 + ", " + v2 + ", " + v3)
            }
        }

        this.twin = other
        other.twin = this

        const edge = this.edge || other.edge
        this.edge = edge
        other.edge = edge
        edge.halfEdge = this
    }

    get prev(): HalfEdge
    {
        let curr: HalfEdge = this;
        do
        {
            curr = curr.next
        } while (curr.next !== this)

        //console.log("prev of ", this, "is", curr)

        return curr;
    }

}
