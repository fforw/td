import "./style.css"
import {
    Box3, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight,
    LineBasicMaterial, LineSegments, type Material, Mesh, MeshStandardMaterial, type Object3D, PCFShadowMap,
    PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import HexagonPatch from "./HexagonPatch"
import { randomSeed, resetRandom } from "./util"
import Castle, { filterNeighbors, getNeighbors } from "./Castle"
import { FaceType } from "./geometry"
import type { Face, Point } from "./geometry"
import { squareFace, wallPaths } from "./plan"
import marchingSquares from "./marchingSquares"

const TAU = Math.PI * 2;

/**
 * Size of the hexagon patch faces in 2D units
 */
const FACE_SIZE = 40

/**
 * Scale from 2D plan units to 3D world units. One face is roughly one world unit, which is the grid size of the
 * Kenney kits.
 */
const SCALE = 1 / FACE_SIZE

const MEDIA = import.meta.env.BASE_URL + "media/"

const MODELS = {
    wall: "castle/wall.glb",
    tower: "castle/tower-square.glb",
    towerRoof: "castle/tower-square-top-roof.glb",
    gateway: "castle/wall-doorway.glb",
    gateTower: "castle/tower-hexagon-base.glb",
    gateTowerRoof: "castle/tower-hexagon-roof.glb",

    houseBlock: "town/wallBlock.glb",
    houseWoodBlock: "town/wallWoodBlock.glb",
    roof: "town/roofPoint.glb",
    roofHigh: "town/roofHighPoint.glb",
    fountain: "town/fountainRound.glb",
    stall: "town/stall.glb",
    stallRed: "town/stallRed.glb",
    stallGreen: "town/stallGreen.glb",

    tree: "nature/tree_default.glb",
    treeOak: "nature/tree_oak.glb",
    pine: "nature/tree_pineRoundA.glb",
    pine2: "nature/tree_pineRoundC.glb",
    rock: "nature/rock_largeA.glb",
    rock2: "nature/rock_largeC.glb",
    rock3: "nature/rock_tallA.glb",
}

type ModelName = keyof typeof MODELS

/**
 * Ground colors for the face types. The 2D colors are made for a black background and are too dark for a lit scene.
 */
const GROUND_COLORS = new Map<FaceType, string>([
    [FaceType.DIRT, "#8a6a3e"],
    [FaceType.PAVED, "#9a968c"],
    [FaceType.GRASS, "#5c9e3c"],
    [FaceType.SAND, "#d8c98a"],
    [FaceType.WATER, "#3a6ea5"],
    [FaceType.ROCK, "#6f8f4a"],
    [FaceType.FOREST_FLOOR, "#4a5a2a"],
    [FaceType.TREE, "#5c9e3c"],
    [FaceType.TREE2, "#4f8f36"],
    [FaceType.WALL, "#618336"],
    [FaceType.GATE, "#9a968c"],
    [FaceType.MARKET, "#b5ae9c"],
    [FaceType.PLOT, "#a68a5c"],
    [FaceType.HOUSE, "#8a7a5e"],
])

const WALL_HEIGHT = 0.6
const WALL_THICKNESS = 0.4
const TOWER_SIZE = 0.66

/**
 * Minimum change of direction for a wall corner to get a tower
 */
const TOWER_MIN_TURN = 0.4

/**
 * Minimum distance between towers in world units
 */
const TOWER_MIN_DISTANCE = 2.5

const GATE_HEIGHT = WALL_HEIGHT * 1.15

/**
 * Thickness of the gateway arch, measured along the road
 */
const GATE_THICKNESS = 0.85

/**
 * Depth of the area around a gate in which walls are cut away, measured along the road
 */
const GATE_CLEARANCE = 2

const GATE_MIN_WIDTH = 1
const GATE_MAX_WIDTH = 2.2

const MARKET_FOUNTAIN_SCALE = 0.3

/**
 * Draw the face grid lines on top of the ground (0 = off, 1 = on)
 */
const DEBUG_GRID = 0

/**
 * Height of the face grid lines above the ground
 */
const GRID_HEIGHT = 0.005
const MARKET_STALL_SCALE = 0.36

/**
 * A gate where a road crosses the wall
 */
interface Gate
{
    center: Vector3
    /**
     * Unit vector along the road, pointing outwards
     */
    road: Vector3
    /**
     * Unit vector along the wall
     */
    side: Vector3
    /**
     * Width of the gate along the wall
     */
    width: number
}

const templates = new Map<ModelName, Object3D>()

function loadModels(): Promise<void>
{
    const loader = new GLTFLoader()
    return Promise.all(
        Object.entries(MODELS).map(
            ([name, file]) => loader.loadAsync(MEDIA + file).then(gltf => {
                gltf.scene.traverse(obj => {
                    const mesh = obj as Mesh
                    if (mesh.isMesh)
                    {
                        const materials = [mesh.material].flat()

                        // transparent surfaces like the fountain water would shadow themselves, causing flickering
                        // shadow acne
                        mesh.castShadow = !materials.some(m => m.transparent)
                        mesh.receiveShadow = true

                        // the Fantasy Town and Nature kits export fully metallic materials which render black
                        // without an environment map
                        for (const material of materials)
                        {
                            (material as MeshStandardMaterial).metalness = 0
                        }
                    }
                })
                templates.set(name as ModelName, gltf.scene)
            })
        )
    ).then(() => undefined)
}

function model(name: ModelName): Object3D
{
    return templates.get(name)!.clone()
}

/**
 * Deterministic pseudo random value in [0,1) for a face, so that decorations don't disturb the castle rng sequence
 */
function hash(face: Face, salt = 0): number
{
    let h = Math.imul(face.id + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 12
    return (h >>> 0) / 0x100000000
}

function pick<T>(face: Face, items: T[], salt = 0): T
{
    return items[Math.floor(hash(face, salt) * items.length)]
}

function toWorld(pt: Point, y = 0): Vector3
{
    return new Vector3(pt[0] * SCALE, y, pt[1] * SCALE)
}

/**
 * Converts an angle in the 2D plan to a rotation around the 3D y-axis. Plan y maps to world z, which mirrors the
 * rotation direction.
 */
function toRotationY(angle: number): number
{
    return -angle
}

function createGround(faces: Face[]): THREE.Group
{
    const positions: number[] = []
    const colors: number[] = []

    const color = new Color()

    marchingSquares(faces, (type, x0, z0, x1, z1, x2, z2) => {
        color.set(GROUND_COLORS.get(type) ?? type.color)

        // wind the triangle so the normal points up
        const ccw = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) < 0
        if (ccw)
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x1 * SCALE, 0, z1 * SCALE, x2 * SCALE, 0, z2 * SCALE)
        }
        else
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x2 * SCALE, 0, z2 * SCALE, x1 * SCALE, 0, z1 * SCALE)
        }
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b)
    })

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    const mesh = new Mesh(
        geometry,
        new MeshStandardMaterial({ vertexColors: true, roughness: 1 })
    )
    mesh.receiveShadow = true

    const group = new Group()
    group.add(mesh)

    if (DEBUG_GRID)
    {
        group.add(createGrid(faces))
    }
    return group
}

/**
 * Lines along the true face borders, which the marching squares ground no longer shows
 */
function createGrid(faces: Face[]): LineSegments
{
    const edges: number[] = []
    for (const face of faces)
    {
        const first = face.halfEdge
        let curr = first
        do
        {
            const next = curr.next
            edges.push(
                curr.vertex.x * SCALE, GRID_HEIGHT, curr.vertex.y * SCALE,
                next.vertex.x * SCALE, GRID_HEIGHT, next.vertex.y * SCALE
            )
            curr = next
        } while (curr !== first)
    }

    const edgeGeometry = new BufferGeometry()
    edgeGeometry.setAttribute("position", new Float32BufferAttribute(edges, 3))
    return new LineSegments(
        edgeGeometry,
        new LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.12 })
    )
}

function createHouse(face: Face): Object3D
{
    const [pt, size, angle] = squareFace(face)

    // size is the diagonal of the square
    const side = size * SCALE / Math.SQRT2
    const height = side * (0.8 + hash(face, 1) * 0.6)

    const house = new Group()

    const block = model(hash(face, 2) < 0.3 ? "houseWoodBlock" : "houseBlock")
    block.scale.set(side, height, side)
    house.add(block)

    const roof = model(hash(face, 3) < 0.4 ? "roofHigh" : "roof")
    roof.scale.set(side, side, side)
    roof.position.y = height
    house.add(roof)

    house.position.copy(toWorld(pt))
    house.rotation.y = toRotationY(angle)
    return house
}

function createTree(face: Face): Object3D
{
    const tree = model(face.type === FaceType.TREE ? pick(face, ["tree", "treeOak"] as ModelName[]) : pick(face, ["pine", "pine2"] as ModelName[]))
    const s = 0.6 + hash(face, 1) * 0.3
    tree.scale.set(s, s, s)
    tree.position.copy(toWorld(face.centroid))
    tree.rotation.y = hash(face, 2) * TAU
    return tree
}

function createRock(face: Face): Object3D
{
    const rock = model(pick(face, ["rock", "rock2", "rock3"] as ModelName[]))
    rock.position.copy(toWorld(face.centroid))
    rock.rotation.y = hash(face, 2) * TAU
    return rock
}

function createMarketDecoration(face: Face, centerFace: Face): Object3D | null
{
    if (face === centerFace)
    {
        const fountain = model("fountain")
        fountain.scale.setScalar(MARKET_FOUNTAIN_SCALE)
        // the pool floor of the fountain is at the model's base, lift it above the ground and the grid lines
        fountain.position.copy(toWorld(face.centroid, GRID_HEIGHT * 2))
        return fountain
    }

    if (hash(face, 1) < 0.5)
    {
        return null
    }

    const stall = model(pick(face, ["stall", "stallRed", "stallGreen"] as ModelName[], 2))
    const pos = toWorld(face.centroid)
    stall.scale.setScalar(MARKET_STALL_SCALE)
    stall.position.copy(pos)
    // face the fountain
    const center = toWorld(centerFace.centroid)
    stall.rotation.y = Math.atan2(center.x - pos.x, center.z - pos.z) + TAU / 4
    return stall
}

function createTower(pt: Vector3, gate: boolean): Object3D
{
    const tower = new Group()

    const height = gate ? WALL_HEIGHT * 1.6 : WALL_HEIGHT * 1.35
    const base = model(gate ? "gateTower" : "tower")
    base.scale.set(TOWER_SIZE, height / 1.31, TOWER_SIZE)
    tower.add(base)

    const roof = model(gate ? "gateTowerRoof" : "towerRoof")
    roof.scale.setScalar(TOWER_SIZE)
    roof.position.y = height
    tower.add(roof)

    tower.position.copy(pt)
    return tower
}

/**
 * Returns the change of direction at p1 when going from p0 over p1 to p2, in the range -PI to PI.
 */
function turnAngle(p0: Vector3, p1: Vector3, p2: Vector3): number
{
    const a0 = Math.atan2(p1.z - p0.z, p1.x - p0.x)
    const a1 = Math.atan2(p2.z - p1.z, p2.x - p1.x)
    let d = a1 - a0
    if (d > Math.PI)
    {
        d -= TAU
    }
    else if (d < -Math.PI)
    {
        d += TAU
    }
    return d
}

/**
 * Returns the direction of the road through the given group of gate faces, from the paved neighbor face nearest to
 * the castle center to the one furthest away, or null if the gate does not have two paved neighbors.
 */
function roadDirection(group: Face[], castleCenter: Vector3): Vector3 | null
{
    const paved = new Set<Face>()
    for (const f of group)
    {
        for (const n of filterNeighbors(f, FaceType.PAVED))
        {
            paved.add(n)
        }
    }

    let inner: Vector3 | null = null
    let outer: Vector3 | null = null
    for (const f of paved)
    {
        const pt = toWorld(f.centroid)
        if (!inner || pt.distanceTo(castleCenter) < inner.distanceTo(castleCenter))
        {
            inner = pt
        }
        if (!outer || pt.distanceTo(castleCenter) > outer.distanceTo(castleCenter))
        {
            outer = pt
        }
    }

    if (!inner || !outer || inner === outer)
    {
        return null
    }
    return outer.sub(inner).normalize()
}

/**
 * Groups adjacent GATE faces and returns one gate per group, oriented along the road running through it.
 */
function findGates(faces: Face[], centerFace: Face): Gate[]
{
    const castleCenter = toWorld(centerFace.centroid)

    const gates: Gate[] = []
    const visited = new Set<Face>()

    for (const face of faces)
    {
        if (face.type !== FaceType.GATE || visited.has(face))
        {
            continue
        }

        const group: Face[] = []
        const open = [face]
        visited.add(face)
        while (open.length)
        {
            const f = open.pop()!
            group.push(f)
            for (const n of getNeighbors(f))
            {
                if (n.type === FaceType.GATE && !visited.has(n))
                {
                    visited.add(n)
                    open.push(n)
                }
            }
        }

        const center = new Vector3()
        for (const f of group)
        {
            center.add(toWorld(f.centroid))
        }
        center.divideScalar(group.length)

        const road = roadDirection(group, castleCenter) ?? center.clone().sub(castleCenter).normalize()
        const side = new Vector3(-road.z, 0, road.x)

        // extent of the gate faces along the wall
        let min = Infinity, max = -Infinity
        for (const f of group)
        {
            const first = f.halfEdge
            let curr = first
            do
            {
                const v = curr.vertex
                const d = (v.x * SCALE - center.x) * side.x + (v.y * SCALE - center.z) * side.z
                min = Math.min(min, d)
                max = Math.max(max, d)
                curr = curr.next
            } while (curr !== first)
        }

        const width = Math.min(GATE_MAX_WIDTH, Math.max(GATE_MIN_WIDTH, max - min))
        gates.push({ center, road, side, width })
    }
    return gates
}

function isInGate(pt: Vector3, gate: Gate, margin = 0): boolean
{
    const dx = pt.x - gate.center.x
    const dz = pt.z - gate.center.z
    return (
        Math.abs(dx * gate.road.x + dz * gate.road.z) <= GATE_CLEARANCE / 2 + margin &&
        Math.abs(dx * gate.side.x + dz * gate.side.z) <= gate.width / 2 + margin
    )
}

/**
 * Returns the parameter interval in which the segment from p0 to p1 runs through the clearance area of the gate, or
 * null if it doesn't (Liang-Barsky clipping in the local coordinates of the gate).
 */
function clipToGate(p0: Vector3, p1: Vector3, gate: Gate): [number, number] | null
{
    const { center, road, side, width } = gate

    const x0 = p0.x - center.x, z0 = p0.z - center.z
    const dx = p1.x - p0.x, dz = p1.z - p0.z

    let tIn = 0, tOut = 1

    const axes: [Vector3, number][] = [[road, GATE_CLEARANCE / 2], [side, width / 2]]
    for (const [axis, half] of axes)
    {
        const u0 = x0 * axis.x + z0 * axis.z
        const du = dx * axis.x + dz * axis.z

        if (Math.abs(du) < 1e-9)
        {
            if (Math.abs(u0) > half)
            {
                return null
            }
            continue
        }

        let t0 = (-half - u0) / du
        let t1 = (half - u0) / du
        if (t0 > t1)
        {
            [t0, t1] = [t1, t0]
        }
        tIn = Math.max(tIn, t0)
        tOut = Math.min(tOut, t1)
        if (tIn >= tOut)
        {
            return null
        }
    }
    return [tIn, tOut]
}

function createGate(gate: Gate): Group
{
    const group = new Group()

    // the doorway model is half a unit thick on its negative x-side and runs along its local z-axis
    const gateway = model("gateway")
    const sx = GATE_THICKNESS / 0.5
    gateway.scale.set(sx, GATE_HEIGHT / 1.31, gate.width)
    gateway.position.x = 0.25 * sx
    group.add(gateway)

    for (const z of [-gate.width / 2, gate.width / 2])
    {
        group.add(createTower(new Vector3(0, 0, z), true))
    }

    group.position.copy(gate.center)
    // local x along the road
    group.rotation.y = Math.atan2(-gate.road.z, gate.road.x)
    return group
}

function addWallPiece(group: Group, p0: Vector3, p1: Vector3): void
{
    const dx = p1.x - p0.x
    const dz = p1.z - p0.z
    const length = Math.sqrt(dx * dx + dz * dz)
    if (length < 0.05)
    {
        return
    }

    // the wall model runs along its local z-axis
    const wall = model("wall")
    wall.scale.set(WALL_THICKNESS, WALL_HEIGHT / 1.31, length)
    wall.position.set((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2)
    wall.rotation.y = Math.atan2(dx, dz)
    group.add(wall)
}

/**
 * Part of a wall segment as start and end parameter and the gates that cut off the start and the end, if any
 */
type WallInterval = [number, number, Gate | null, Gate | null]

function nearestGateTower(gate: Gate, pt: Vector3): Vector3
{
    const { center, side, width } = gate
    const d = (pt.x - center.x) * side.x + (pt.z - center.z) * side.z
    return center.clone().addScaledVector(side, d < 0 ? -width / 2 : width / 2)
}

function createWall(path: Point[], gates: Gate[]): Group
{
    const group = new Group()

    const pts = path.map(pt => toWorld(pt))

    for (let i = 1; i < pts.length; i++)
    {
        const p0 = pts[i - 1]
        const p1 = pts[i]

        // cut the parts of the segment running through gates, remembering which gate cut which end
        let intervals: WallInterval[] = [[0, 1, null, null]]
        for (const gate of gates)
        {
            const clip = clipToGate(p0, p1, gate)
            if (clip)
            {
                const [tIn, tOut] = clip
                intervals = intervals.flatMap(([a, b, gateA, gateB]): WallInterval[] => [
                    b > tIn ? [a, tIn, gateA, gate] : [a, b, gateA, gateB],
                    a < tOut ? [tOut, b, gate, gateB] : [a, b, gateA, gateB]
                ]).filter(([a, b]) => b > a)
            }
        }

        for (const [a, b, gateA, gateB] of intervals)
        {
            const start = p0.clone().lerp(p1, a)
            const end = p0.clone().lerp(p1, b)
            addWallPiece(group, start, end)

            // connect ends cut by a gate to the nearest gate tower
            if (gateA)
            {
                addWallPiece(group, nearestGateTower(gateA, start), start)
            }
            if (gateB)
            {
                addWallPiece(group, end, nearestGateTower(gateB, end))
            }
        }
    }

    const insideGate = (pt: Vector3) => gates.some(gate => isInGate(pt, gate, TOWER_SIZE / 2))

    // the first and last point of the path are next to the gates, which have their own towers. If the path didn't
    // end at a gate, we close it with a tower
    const last = pts.length - 1
    for (const pt of [pts[0], pts[last]])
    {
        if (!insideGate(pt))
        {
            group.add(createTower(pt, true))
        }
    }

    // towers at the sharper corners of the wall, if they're not too close to the previous tower or the end gate
    let prevTower = pts[0]
    for (let i = 1; i < last; i++)
    {
        const pt = pts[i]
        const turn = Math.abs(turnAngle(pts[i - 1], pt, pts[i + 1]))
        if (
            turn >= TOWER_MIN_TURN &&
            pt.distanceTo(prevTower) >= TOWER_MIN_DISTANCE &&
            pt.distanceTo(pts[last]) >= TOWER_MIN_DISTANCE &&
            !insideGate(pt)
        )
        {
            group.add(createTower(pt, false))
            prevTower = pt
        }
    }

    return group
}


// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap

const scene = new Scene()
scene.background = new Color("#a9c8e8")

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47
controls.minDistance = 2

scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))

const sun = new DirectionalLight("#fff4e0", 2.5)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.02

console.log("SUN", sun.position, sun.target.position)

scene.add(sun, sun.target)

let castleGroup: Group | null = null

function disposeGroup(group: Group): void
{
    // models share their geometry and materials with the templates, only the ground owns its resources
    const ground = group.children[0]
    ground.traverse(obj => {
        const { geometry, material } = obj as Mesh
        if (geometry)
        {
            geometry.dispose()
            ;(material as Material).dispose()
        }
    })
}

const seedParam = new URLSearchParams(location.search).get("seed")
let fixed: HTMLAnchorElement | undefined
let firstBuild = true

function build(): void
{
    const seed = randomSeed(firstBuild && seedParam ? +seedParam : null)

    if (!fixed)
    {
        fixed = document.createElement("a")
        fixed.appendChild(document.createTextNode("seed"))
        const footer = document.getElementById("footer")!
        footer.appendChild(document.createTextNode(" "))
        footer.appendChild(fixed)
    }
    fixed.href = "3d.html?seed=" + seed

    resetRandom(seed)

    const faces = new HexagonPatch(0, 0, FACE_SIZE).build()
    const castle = new Castle(faces)

    if (castleGroup)
    {
        scene.remove(castleGroup)
        disposeGroup(castleGroup)
    }

    const group = new Group()
    group.add(createGround(faces))

    for (const face of faces)
    {
        let obj: Object3D | null = null
        switch (face.type)
        {
            case FaceType.HOUSE:
                obj = createHouse(face)
                break
            case FaceType.TREE:
            case FaceType.TREE2:
                obj = createTree(face)
                break
            case FaceType.ROCK:
                obj = createRock(face)
                break
            case FaceType.MARKET:
                obj = createMarketDecoration(face, castle.centerFace)
                break
        }
        if (obj)
        {
            group.add(obj)
        }
    }

    const gates = findGates(faces, castle.centerFace)
    for (const gate of gates)
    {
        group.add(createGate(gate))
    }

    for (const path of wallPaths(castle))
    {
        group.add(createWall(path, gates))
    }

    scene.add(group)
    castleGroup = group

    if (firstBuild)
    {
        const box = new Box3().setFromObject(group)
        const radius = box.getBoundingSphere(new Sphere()).radius

        camera.position.set(0, radius * 1.1, radius * 1.3)
        controls.target.set(0, 0, 0)
        controls.maxDistance = radius * 4

        sun.position.set(-radius, radius * 1.5, radius * 0.6)
        const cam = sun.shadow.camera
        cam.left = cam.bottom = -radius
        cam.right = cam.top = radius
        cam.far = radius * 5
        cam.updateProjectionMatrix()

        firstBuild = false
    }
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// a click without dragging builds a new castle, like in the 2D version
let downX = 0, downY = 0
canvas.addEventListener("pointerdown", ev => {
    downX = ev.clientX
    downY = ev.clientY
})
canvas.addEventListener("pointerup", ev => {
    const dx = ev.clientX - downX
    const dy = ev.clientY - downY
    if (ev.button === 0 && dx * dx + dy * dy < 16)
    {
        build()
    }
})

loadModels().then(() => {
    build()
    renderer.setAnimationLoop(() => {
        controls.update()
        renderer.render(scene, camera)
    })
})
