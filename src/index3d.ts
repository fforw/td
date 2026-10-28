import "./style.css"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import HexagonPatch from "./HexagonPatch"
import { randomSeed, resetRandom } from "./util"
import Castle from "./Castle"
import { FaceType } from "./geometry"
import type { Face, Point } from "./geometry"
import { squareFace, wallPaths } from "./plan"

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
    [FaceType.WALL, "#7b7a74"],
    [FaceType.GATE, "#9a968c"],
    [FaceType.MARKET, "#b5ae9c"],
    [FaceType.PLOT, "#a68a5c"],
    [FaceType.HOUSE, "#8a7a5e"],
])

const WALL_HEIGHT = 1.2
const WALL_THICKNESS = 0.6
const TOWER_SIZE = 0.75

/**
 * Minimum change of direction for a wall corner to get a tower
 */
const TOWER_MIN_TURN = 0.4

/**
 * Minimum distance between towers in world units
 */
const TOWER_MIN_DISTANCE = 2.5

const templates = new Map<ModelName, THREE.Object3D>()

function loadModels(): Promise<void>
{
    const loader = new GLTFLoader()
    return Promise.all(
        Object.entries(MODELS).map(
            ([name, file]) => loader.loadAsync(MEDIA + file).then(gltf => {
                gltf.scene.traverse(obj => {
                    const mesh = obj as THREE.Mesh
                    if (mesh.isMesh)
                    {
                        mesh.castShadow = true
                        mesh.receiveShadow = true

                        // the Fantasy Town and Nature kits export fully metallic materials which render black
                        // without an environment map
                        for (const material of [mesh.material].flat())
                        {
                            (material as THREE.MeshStandardMaterial).metalness = 0
                        }
                    }
                })
                templates.set(name as ModelName, gltf.scene)
            })
        )
    ).then(() => undefined)
}

function model(name: ModelName): THREE.Object3D
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

function toWorld(pt: Point, y = 0): THREE.Vector3
{
    return new THREE.Vector3(pt[0] * SCALE, y, pt[1] * SCALE)
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
    const edges: number[] = []

    const color = new THREE.Color()

    for (const face of faces)
    {
        color.set(GROUND_COLORS.get(face.type) ?? face.type.color)

        const [cx, cy] = face.centroid

        const first = face.halfEdge
        let curr = first
        do
        {
            const next = curr.next
            const x0 = curr.vertex.x * SCALE
            const z0 = curr.vertex.y * SCALE
            const x1 = next.vertex.x * SCALE
            const z1 = next.vertex.y * SCALE

            // fan triangle from the centroid, wound so the normal points up
            const ccw = (x0 - cx * SCALE) * (z1 - cy * SCALE) - (z0 - cy * SCALE) * (x1 - cx * SCALE) < 0
            if (ccw)
            {
                positions.push(cx * SCALE, 0, cy * SCALE, x0, 0, z0, x1, 0, z1)
            }
            else
            {
                positions.push(cx * SCALE, 0, cy * SCALE, x1, 0, z1, x0, 0, z0)
            }
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b)

            edges.push(x0, 0.005, z0, x1, 0.005, z1)

            curr = next
        } while (curr !== first)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
    )
    mesh.receiveShadow = true

    const edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3))
    const lines = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.12 })
    )

    const group = new THREE.Group()
    group.add(mesh, lines)
    return group
}

function createHouse(face: Face): THREE.Object3D
{
    const [pt, size, angle] = squareFace(face)

    // size is the diagonal of the square
    const side = size * SCALE / Math.SQRT2
    const height = side * (0.8 + hash(face, 1) * 0.6)

    const house = new THREE.Group()

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

function createTree(face: Face): THREE.Object3D
{
    const tree = model(face.type === FaceType.TREE ? pick(face, ["tree", "treeOak"] as ModelName[]) : pick(face, ["pine", "pine2"] as ModelName[]))
    const s = 0.6 + hash(face, 1) * 0.3
    tree.scale.set(s, s, s)
    tree.position.copy(toWorld(face.centroid))
    tree.rotation.y = hash(face, 2) * TAU
    return tree
}

function createRock(face: Face): THREE.Object3D
{
    const rock = model(pick(face, ["rock", "rock2", "rock3"] as ModelName[]))
    rock.position.copy(toWorld(face.centroid))
    rock.rotation.y = hash(face, 2) * TAU
    return rock
}

function createMarketDecoration(face: Face, centerFace: Face): THREE.Object3D | null
{
    if (face === centerFace)
    {
        const fountain = model("fountain")
        fountain.scale.setScalar(0.5)
        fountain.position.copy(toWorld(face.centroid))
        return fountain
    }

    if (hash(face, 1) < 0.5)
    {
        return null
    }

    const stall = model(pick(face, ["stall", "stallRed", "stallGreen"] as ModelName[], 2))
    const pos = toWorld(face.centroid)
    stall.position.copy(pos)
    // face the fountain
    const center = toWorld(centerFace.centroid)
    stall.rotation.y = Math.atan2(center.x - pos.x, center.z - pos.z) + TAU / 4
    return stall
}

function createTower(pt: THREE.Vector3, gate: boolean): THREE.Object3D
{
    const tower = new THREE.Group()

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
function turnAngle(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): number
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

function createWall(path: Point[]): THREE.Group
{
    const group = new THREE.Group()

    const pts = path.map(pt => toWorld(pt))

    for (let i = 1; i < pts.length; i++)
    {
        const p0 = pts[i - 1]
        const p1 = pts[i]

        const dx = p1.x - p0.x
        const dz = p1.z - p0.z
        const length = Math.sqrt(dx * dx + dz * dz)

        // the wall model runs along its local z-axis
        const wall = model("wall")
        wall.scale.set(WALL_THICKNESS, WALL_HEIGHT / 1.31, length)
        wall.position.set((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2)
        wall.rotation.y = Math.atan2(dx, dz)
        group.add(wall)
    }

    // the first and last point of the path are next to the gates
    const last = pts.length - 1
    group.add(createTower(pts[0], true))
    group.add(createTower(pts[last], true))

    // towers at the sharper corners of the wall, if they're not too close to the previous tower or the end gate
    let prevTower = pts[0]
    for (let i = 1; i < last; i++)
    {
        const pt = pts[i]
        const turn = Math.abs(turnAngle(pts[i - 1], pt, pts[i + 1]))
        if (
            turn >= TOWER_MIN_TURN &&
            pt.distanceTo(prevTower) >= TOWER_MIN_DISTANCE &&
            pt.distanceTo(pts[last]) >= TOWER_MIN_DISTANCE
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

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color("#a9c8e8")

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47
controls.minDistance = 2

scene.add(new THREE.HemisphereLight("#dfefff", "#5c6e3c", 1.6))

const sun = new THREE.DirectionalLight("#fff4e0", 2.5)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target)

let castleGroup: THREE.Group | null = null

function disposeGroup(group: THREE.Group): void
{
    // models share their geometry and materials with the templates, only the ground owns its resources
    const ground = group.children[0]
    ground.traverse(obj => {
        const { geometry, material } = obj as THREE.Mesh
        if (geometry)
        {
            geometry.dispose()
            ;(material as THREE.Material).dispose()
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

    const group = new THREE.Group()
    group.add(createGround(faces))

    for (const face of faces)
    {
        let obj: THREE.Object3D | null = null
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

    for (const path of wallPaths(castle))
    {
        group.add(createWall(path))
    }

    scene.add(group)
    castleGroup = group

    if (firstBuild)
    {
        const box = new THREE.Box3().setFromObject(group)
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius

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
