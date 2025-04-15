let vertexCounter = 1000;

export class Vertex
{
    /**
     * X coordinate
     * @type {number}
     */
    x;
    /**
     * Y coordinate
     * @type {number}
     */
    y;

    /**
     * Z coordinate
     * @type {number}
     */
    z;

    /**
     * Half-edge 
     * @type {null}
     */
    halfEdge = null;

    constructor(x, y, z, halfEdge)
    {
        this.x = x;
        this.y = y;
        this.z = z;

        this.halfEdge = halfEdge;
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
     *
     * @type {HalfEdge}
     */
    halfEdge = null;
    constructor(halfEdge)
    {
        this.halfEdge = halfEdge;
    }

}
let faceCounter = 0;

let _faceTypeNames;

export class FaceType
{
    name = ""

    color = "#fff"
    terrain = 1
    occupied = false

    constructor(opts)
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

    static names()
    {
        return _faceTypeNames
    }

}

// INITIALIZE FACE TYPE NAMES
(
    () => {

        _faceTypeNames = []

        for (let name in FaceType)
        {
            if (FaceType.hasOwnProperty(name))
            {
                let ft = FaceType[name]
                if (ft instanceof FaceType)
                {
                    ft.name = name
                    _faceTypeNames.push(name)
                }
            }
        }
    }
)()

console.log("OCCUPIED", _faceTypeNames.filter(n => FaceType[n].occupied))


export class Face
{
    /**
     * First half edge of the face interior, part of a closed loop back to the fist edge.
     *
     * @type {HalfEdge}
     */
    halfEdge = null;

    /**
     * Type of the data
     *
     * @type {FaceType}
     */
    type = FaceType.DIRT

    constructor(halfEdge)
    {
        this.halfEdge = halfEdge;
        this.id = faceCounter++;

    }
    get length()
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
     * @return {number[]} x/y/z as array
     */
    get centroid()
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
     * @type {HalfEdge}
     */
    next = null;

    /**
     * Twin halfEdge from another face
     * @type {HalfEdge}
     */
    twin = null;
    /**
     * Vertex of this half edge
     * @type {Vertex}
     */
    vertex = null;

    /**
     * The edge the half edge belongs to
     * @type {Edge}
     */
    edge = null;

    /**
     * The face the half edge belongs to
     * @type {Face}
     */
    face = null;


    constructor(next, vertex, edge, face)
    {
        this.next = next;
        this.twin = null;
        this.vertex = vertex;
        this.edge = edge;
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


    twinWith(other)
    {
        if (__DEV)
        {
            let { vertex : v0 } = this
            let { vertex : v1 } = this.next
            let { vertex : v2 } = other
            let { vertex : v3 } = other.next

            if (v0.x !== v3.x || v0.y !== v3.y || v1.x !== v2.x || v1.y !== v2.y)
            {
                throw new Error("Half edge coords not twinned " + this + ": " + v0 + ", " + v1 + ", " + v2 + ", " + v3)
            }
        }

        this.twin = other
        other.twin = this

        this.vertex = other.next.vertex
        other.vertex = this.next.vertex
        
        other.edge = this.edge || other.edge
        other.edge.halfEdge = this
    }

    get prev()
    {
        let curr = this;
        do
        {
            curr = curr.next
        } while (curr.next !== this)

        //console.log("prev of ", this, "is", curr)

        return curr;
    }

}
