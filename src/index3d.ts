import "./style.css"
import {
    Box3,
    BufferGeometry,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    type Material,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
    PCFShadowMap,
    PerspectiveCamera,
    Scene,
    Sphere,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import HexagonPatch from "./map/HexagonPatch"
import { randomSeed, resetRandom, rng } from "./core/util"
import Castle from "./castle/Castle"
import { createCastle } from "./castle/castle3d"
import { planCastle, toWorld } from "./castle/castlePlan"
import type { Face } from "./core/geometry"
import { FaceType } from "./core/geometry"
import marchingSquares from "./map/marchingSquares"
import { FACE_SIZE, GROUND_COLORS, loadModels, model, type ModelName, SCALE } from "./render/scene3d"

const TAU = Math.PI * 2;

/**
 * Draw the face grid lines on top of the ground (0 = off, 1 = on)
 */
const DEBUG_GRID = 0

/**
 * Height of the face grid lines above the ground
 */
const GRID_HEIGHT = 0.005

function pick<T>(face: Face, items: T[], salt = 0): T
{
    return items[Math.floor(rng.next() * items.length)]
}


function createGround(faces: Face[]): Group
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

function createTree(face: Face): Object3D
{
    const tree = model(face.type === FaceType.TREE ? pick(face, ["tree", "treeOak"] as ModelName[]) : pick(face, ["pine", "pine2"] as ModelName[]))
    const s = 0.4 + rng.next() * 0.2
    tree.scale.set(s, s, s)
    tree.position.copy(toWorld(face.centroid))
    tree.rotation.y = rng.next() * TAU
    return tree
}

function createRock(face: Face): Object3D
{
    const rock = model(pick(face, ["rock", "rock2", "rock3"] as ModelName[]))
    rock.position.copy(toWorld(face.centroid))
    rock.rotation.y = rng.next() * TAU
    return rock
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

    group.add(createCastle(planCastle(faces, castle)))

    for (const face of faces)
    {
        let obj: Object3D | null = null
        switch (face.type)
        {
            case FaceType.TREE:
            case FaceType.TREE2:
                obj = createTree(face)
                break
            case FaceType.ROCK:
                obj = createRock(face)
                break
        }
        if (obj)
        {
            group.add(obj)
        }
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
