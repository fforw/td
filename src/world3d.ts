import "./style.css"
import {
    BufferGeometry,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PCFShadowMap,
    PerspectiveCamera,
    Quaternion,
    Scene,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { createCastle } from "./castle/castle3d"
import { FaceType } from "./map/geometry"
import { PATCH_SIZE } from "./map/HexagonPatch"
import MapWorkerClient, { type BuiltPatch } from "./map/MapWorkerClient"
import { marchingSquaresPatch } from "./map/marchingSquares"
import PatchWorld from "./map/PatchWorld"
import type { QuadPatch } from "./map/QuadPatch"
import { FACE_SIZE, GROUND_COLORS, instanceModel, loadModels, type ModelName, SCALE } from "./render/scene3d"
import { patchSeed, randomSeed } from "./math/random"

/*
 * Endless map of packed patches, built by the map worker around the point the camera looks at.
 */

const TAU = Math.PI * 2

/**
 * Size of a patch in world units, see createHexagon()
 */
const PATCH_WIDTH = Math.sqrt(3) * FACE_SIZE * PATCH_SIZE * SCALE
const PATCH_DEPTH = 1.5 * FACE_SIZE * PATCH_SIZE * SCALE

/**
 * Distance of the sun from the point the camera looks at and the area around it that gets shadows, in world units
 */
const SUN_DISTANCE = 40
const SHADOW_RADIUS = 30

/**
 * Top speed of moving with the cursor keys in camera distances per second, and how quickly the movement follows the
 * keys, as rate of an exponential approach
 */
const KEY_SPEED = 0.8
const KEY_RESPONSE = 6

const params = new URLSearchParams(location.search)

/**
 * Number of patches loaded in every direction from the patch the camera looks at. Patches one further out stay loaded
 * so moving back and forth along a patch border doesn't reload them.
 */
const LOAD_RADIUS = Math.max(0, Number(params.get("radius") ?? 1))

/**
 * Models per face type with the range of their random scale
 */
const FACE_MODELS = new Map<FaceType, { names: ModelName[], scale: [number, number] }>([
    [FaceType.TREE, { names: ["tree", "treeOak"], scale: [0.4, 0.6] }],
    [FaceType.TREE2, { names: ["pine", "pine2"], scale: [0.4, 0.6] }],
    [FaceType.ROCK, { names: ["rock", "rock2", "rock3"], scale: [1, 1] }],
])

interface LoadedPatch
{
    key: string
    slot: number
    group: Group
    ground: Mesh | null
}


/**
 * Random numbers that only depend on the patch and face, so a patch looks the same whenever it gets loaded
 */
function faceRandom(patch: QuadPatch, face: number): () => number
{
    let s = patchSeed(face, patch.q, patch.r)
    return () => {
        // mulberry32
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}


function createModels(patch: QuadPatch): InstancedMesh[]
{
    const { positions, vertex, faceType } = patch
    const matrices = new Map<ModelName, Matrix4[]>()

    const pos = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    for (let f = 0; f < faceType.length; f++)
    {
        const models = FACE_MODELS.get(FaceType.byIndex(faceType[f]))
        if (!models)
        {
            continue
        }

        let x = 0
        let z = 0
        for (let h = f * 4; h < f * 4 + 4; h++)
        {
            x += positions[vertex[h] * 3]
            z += positions[vertex[h] * 3 + 1]
        }

        const random = faceRandom(patch, f)
        const name = models.names[Math.floor(random() * models.names.length)]
        const [min, max] = models.scale
        const s = min + random() * (max - min)

        const matrix = new Matrix4().compose(
            pos.set(x / 4 * SCALE, 0, z / 4 * SCALE),
            rotation.setFromAxisAngle(up, random() * TAU),
            scale.setScalar(s)
        )

        let list = matrices.get(name)
        if (!list)
        {
            list = []
            matrices.set(name, list)
        }
        list.push(matrix)
    }

    return [...matrices].flatMap(([name, list]) => instanceModel(name, list))
}


const groundMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 })

function createGround(world: PatchWorld, slot: number): Mesh
{
    const positions: number[] = []
    const colors: number[] = []
    const color = new Color()

    marchingSquaresPatch(world, slot, (type, x0, z0, x1, z1, x2, z2) => {
        color.set(GROUND_COLORS.get(type) ?? type.color)

        // wind the triangle so the normal points up
        if ((x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) < 0)
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
    geometry.computeBoundingSphere()

    const mesh = new Mesh(geometry, groundMaterial)
    mesh.receiveShadow = true
    return mesh
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
camera.position.set(0, PATCH_DEPTH * 1.1, PATCH_DEPTH * 1.3)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47
controls.minDistance = 2
controls.maxDistance = PATCH_DEPTH * 3
// pan along the ground instead of the screen, so dragging moves over the map
controls.screenSpacePanning = false

scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))

const sunOffset = new Vector3(-1, 1.5, 0.6).setLength(SUN_DISTANCE)
const sun = new DirectionalLight("#fff4e0", 2.5)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.02
const shadowCam = sun.shadow.camera
shadowCam.left = shadowCam.bottom = -SHADOW_RADIUS
shadowCam.right = shadowCam.top = SHADOW_RADIUS
shadowCam.far = SUN_DISTANCE * 2
shadowCam.updateProjectionMatrix()
scene.add(sun, sun.target)

const client = new MapWorkerClient()
const world = new PatchWorld()

const loaded = new Map<string, LoadedPatch>()
const bySlot = new Map<number, LoadedPatch>()
const requested = new Set<string>()

let seed = randomSeed(params.has("seed") ? Number(params.get("seed")) : null)

/**
 * Increases with every new seed, so patches requested for an older seed get dropped
 */
let generation = 0

let centerQ = NaN
let centerR = NaN

function patchKey(pq: number, pr: number): string
{
    return pq + "/" + pr
}


function updateGround(entry: LoadedPatch): void
{
    if (entry.ground)
    {
        entry.group.remove(entry.ground)
        entry.ground.geometry.dispose()
    }
    entry.ground = createGround(world, entry.slot)
    entry.group.add(entry.ground)
}


function addPatch(key: string, { patch, castle }: BuiltPatch): void
{
    const slot = world.add(patch)
    const group = new Group()
    // patches of water or snow have no models, and add() complains about being called without objects
    createModels(patch).forEach(obj => group.add(obj))
    if (castle)
    {
        group.add(createCastle(castle))
    }
    scene.add(group)

    const entry: LoadedPatch = { key, slot, group, ground: null }
    loaded.set(key, entry)
    bySlot.set(slot, entry)

    // the ground along the seams changes for the new patch and its neighbors
    updateGround(entry)
    world.neighbors(slot).forEach(other => updateGround(bySlot.get(other)!))
}


function removePatch(entry: LoadedPatch, updateNeighbors = true): void
{
    const neighbors = world.neighbors(entry.slot)
    world.remove(entry.slot)
    loaded.delete(entry.key)
    bySlot.delete(entry.slot)

    scene.remove(entry.group)
    entry.ground?.geometry.dispose()
    entry.group.children.forEach(obj => (obj as InstancedMesh).isInstancedMesh && (obj as InstancedMesh).dispose())

    if (updateNeighbors)
    {
        neighbors.forEach(other => updateGround(bySlot.get(other)!))
    }
}


/**
 * Loads the patches around the given patch and removes the ones that are too far away
 */
function updatePatches(pq: number, pr: number): void
{
    loaded.forEach(entry => {
        const [q, r] = entry.key.split("/").map(Number)
        if (Math.max(Math.abs(q - pq), Math.abs(r - pr)) > LOAD_RADIUS + 1)
        {
            removePatch(entry)
        }
    })

    const missing: [number, number][] = []
    for (let dr = -LOAD_RADIUS; dr <= LOAD_RADIUS; dr++)
    {
        for (let dq = -LOAD_RADIUS; dq <= LOAD_RADIUS; dq++)
        {
            const key = patchKey(pq + dq, pr + dr)
            if (!loaded.has(key) && !requested.has(key))
            {
                missing.push([pq + dq, pr + dr])
            }
        }
    }

    // the worker answers in order, so start with the patches closest to the camera
    missing.sort((a, b) => Math.hypot(a[0] - pq, a[1] - pr) - Math.hypot(b[0] - pq, b[1] - pr))

    const requestedFor = generation
    for (const [q, r] of missing)
    {
        const key = patchKey(q, r)
        requested.add(key)
        // for now there's only the castle in the starting patch
        client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, q === 0 && r === 0).then(
            result => {
                if (requestedFor !== generation)
                {
                    return
                }
                requested.delete(key)

                // the camera might have moved on while the patch was built
                if (Math.max(Math.abs(q - centerQ), Math.abs(r - centerR)) <= LOAD_RADIUS + 1)
                {
                    addPatch(key, result)
                }
            },
            err => {
                requested.delete(key)
                console.error("Building patch " + key + " failed", err)
            }
        )
    }
}


function updateCenter(): void
{
    // patches cover the hexagons from -PATCH_SIZE / 2 to PATCH_SIZE / 2 - 1 around their position
    const { x, z } = controls.target
    const pq = Math.round(x / PATCH_WIDTH + 0.5 / PATCH_SIZE)
    const pr = Math.round(z / PATCH_DEPTH + 0.5 / PATCH_SIZE)
    if (pq !== centerQ || pr !== centerR)
    {
        centerQ = pq
        centerR = pr
        updatePatches(pq, pr)
    }
}


const seedLink = document.createElement("a")
seedLink.appendChild(document.createTextNode("seed"))
const footer = document.getElementById("footer")!
footer.appendChild(document.createTextNode(" "))
footer.appendChild(seedLink)

function newWorld(newSeed: number): void
{
    seed = newSeed
    seedLink.href = "world.html?seed=" + seed + (params.has("radius") ? "&radius=" + LOAD_RADIUS : "")
    generation++
    requested.clear()
    loaded.forEach(entry => removePatch(entry, false))
    centerQ = centerR = NaN
    updateCenter()
}


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// a click without dragging builds a new world, like in the castle view
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
        newWorld(randomSeed())
    }
})

const pressed = new Set<string>()
window.addEventListener("keydown", ev => {
    if (ev.key.startsWith("Arrow"))
    {
        pressed.add(ev.key)
        // don't scroll the page
        ev.preventDefault()
    }
})
window.addEventListener("keyup", ev => pressed.delete(ev.key))
// we don't get the keyup of keys released while the page has no focus
window.addEventListener("blur", () => pressed.clear())

const keyVelocity = new Vector3()
const keyTarget = new Vector3()
const forward = new Vector3()
const right = new Vector3()

/**
 * Moves the camera together with the point it looks at along the ground, relative to the view direction. The movement
 * speeds up and slows down smoothly and scales with the camera distance, so it feels the same at every zoom level.
 *
 * @param dt    seconds since the last frame
 */
function moveWithKeys(dt: number): void
{
    const sideways = (pressed.has("ArrowRight") ? 1 : 0) - (pressed.has("ArrowLeft") ? 1 : 0)
    const ahead = (pressed.has("ArrowUp") ? 1 : 0) - (pressed.has("ArrowDown") ? 1 : 0)

    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.set(-forward.z, 0, forward.x)

    keyTarget.set(0, 0, 0).addScaledVector(right, sideways).addScaledVector(forward, ahead)
    if (sideways || ahead)
    {
        keyTarget.setLength(KEY_SPEED * camera.position.distanceTo(controls.target))
    }

    keyVelocity.lerp(keyTarget, 1 - Math.exp(-KEY_RESPONSE * dt))
    if (keyVelocity.lengthSq() < 1e-6 && !sideways && !ahead)
    {
        keyVelocity.set(0, 0, 0)
        return
    }

    camera.position.addScaledVector(keyVelocity, dt)
    controls.target.addScaledVector(keyVelocity, dt)
}

let lastTime = 0

loadModels().then(() => {
    newWorld(seed)
    renderer.setAnimationLoop(time => {
        // limit the step after the tab was in the background
        const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0
        lastTime = time

        moveWithKeys(dt)
        controls.update()
        updateCenter()

        // keep the shadowed area around the point the camera looks at, moving in whole units against shimmering
        const { target } = controls
        sun.target.position.set(Math.round(target.x), 0, Math.round(target.z))
        sun.position.copy(sun.target.position).add(sunOffset)

        renderer.render(scene, camera)
    })
})
