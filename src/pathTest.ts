import "./style.css"
import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    type Material,
    Mesh,
    MeshBasicMaterial,
    PCFShadowMap,
    PerspectiveCamera,
    Scene,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { createCastle } from "./castle/castle3d"
import { missionDays } from "./game/missions"
import type { KindEdits } from "./game/campaign"
import { impressionOf, startEdits, wantedKind } from "./game/patchKinds"
import { PATCH_SIZE } from "./map/HexagonPatch"
import PatchWorld, { SLOT_SHIFT } from "./map/PatchWorld"
import { BORDER_FIRST, BORDER_SECOND, BORDER_STRIDE, next } from "./map/QuadPatch"
import { globalFace, unpackPath } from "./map/route"
import { randomSeed } from "./math/random"
import { createGround, createModels } from "./render/patchMeshes"
import { FACE_SIZE, loadModels, SCALE } from "./render/scene3d"
import type { GeneratedPatch } from "./map/patchGenerators"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for routes: the castle and the patches around it, with a form for planning the route of a mission. All
 * q/r in here are grid positions of patches, with the castle at 0/0, like in the campaign. The worker wants hexagon
 * positions, which is PATCH_SIZE times that.
 */

/**
 * Size of a patch in world units, see createHexagon()
 */
const PATCH_WIDTH = Math.sqrt(3) * FACE_SIZE * PATCH_SIZE * SCALE
const PATCH_DEPTH = 1.5 * FACE_SIZE * PATCH_SIZE * SCALE

/**
 * Rings around the castle built before anything is planned
 */
const START_RINGS = 0

const SUN_DISTANCE = 40
const SHADOW_RADIUS = 30

/**
 * Size of the route in world units, a face is about one unit
 */
const LINE_WIDTH = 0.093
const LINE_HEIGHT = 0.06
const MARKER_SIZE = 0.2

/**
 * Camera distance up to which the route keeps its size in world units, further away it grows to stay readable on screen
 */
const ROUTE_SCALE_DISTANCE = 20

const ROUTE_COLOR = "#ffe100"
const FAILED_COLOR = "#ff2d2d"
const START_COLOR = "#ffffff"
const TARGET_COLOR = "#00e5ff"
const SAFE_COLOR = "#7dff6a"
const DANGEROUS_COLOR = "#ff8a00"

/**
 * Explorer speeds the status shows the days for: everyone, a good one and a very good one
 */
const SPEEDS = [1, 1.5, 2]

interface LoadedPatch
{
    slot: number
    group: Group
    ground: Mesh | null
    built: GeneratedPatch
}

const params = new URLSearchParams(location.search)

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement
const form = document.getElementById("plan") as HTMLFormElement
const inputQ = document.getElementById("q") as HTMLInputElement
const inputR = document.getElementById("r") as HTMLInputElement
const inputKnown = document.getElementById("known") as HTMLInputElement
const status = document.getElementById("status")!

function createRenderer(): WebGLRenderer | null
{
    try
    {
        const renderer = new WebGLRenderer({ canvas, antialias: true })
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setSize(window.innerWidth, window.innerHeight)
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = PCFShadowMap
        return renderer
    }
    catch (e)
    {
        console.error("No 3D view", e)
        return null
    }
}

const renderer = createRenderer()

const scene = new Scene()
scene.background = new Color("#a9c8e8")

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47
controls.minDistance = 2
controls.maxDistance = PATCH_DEPTH * 12
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

const seedLink = document.createElement("a")
seedLink.appendChild(document.createTextNode("seed"))
const footer = document.getElementById("footer")!
footer.appendChild(document.createTextNode(" "))
footer.appendChild(seedLink)

let seed = randomSeed(params.has("seed") ? Number(params.get("seed")) : null)
let client = new MapWorkerClient()
let world = new PatchWorld()

/**
 * Kinds of the patches known from the start of a campaign, the worker rolls the others
 */
let kindEdits: KindEdits = {}

const loaded = new Map<string, Promise<LoadedPatch>>()
const bySlot = new Map<number, LoadedPatch>()

let overlay: Group | null = null

/**
 * Bars and markers of the overlay, resized with the camera distance
 */
let bars: Mesh[] = []
let markers: Mesh[] = []

/**
 * Increases with every plan and new seed, so answers to older ones get dropped
 */
let generation = 0


function patchKey(q: number, r: number): string
{
    return q + "/" + r
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


/**
 * Shows a patch. Its ground and models only get created now, hidden ones may never need them again.
 */
function show(entry: LoadedPatch): void
{
    const { group, ground, built } = entry
    if (!ground)
    {
        // patches of water or snow have no models, and add() complains about being called without objects
        createModels(built.patch, built.pois).forEach(obj => group.add(obj))
        const plan = built.pois[0]?.plan
        if (plan)
        {
            group.add(createCastle(plan))
        }
    }
    // the ground along the seams depends on the neighbors, which may have been built since
    updateGround(entry)
    group.visible = true
}


/**
 * Creates a label with the grid position in the middle of a patch
 */
function createLabel(q: number, r: number): Sprite
{
    const label = document.createElement("canvas")
    label.width = 256
    label.height = 96
    const ctx = label.getContext("2d")!
    ctx.fillStyle = "#000a"
    ctx.fillRect(0, 0, label.width, label.height)
    ctx.fillStyle = "#fff"
    ctx.font = "bold 64px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(patchKey(q, r), label.width / 2, label.height / 2)

    const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(label), depthTest: false, transparent: true }))
    sprite.scale.set(PATCH_WIDTH / 4, PATCH_WIDTH * 3 / 32, 1)
    sprite.position.set(q * PATCH_WIDTH, 2, r * PATCH_DEPTH)
    sprite.renderOrder = 20
    return sprite
}


/**
 * Builds the patch at the given grid position for showing it. The worker builds the patches for finding routes itself.
 */
function load(q: number, r: number): Promise<LoadedPatch>
{
    const key = patchKey(q, r)
    let patch = loaded.get(key)
    if (!patch)
    {
        patch = client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, wantedKind(seed, kindEdits, q, r)).then(
            built => {
                const slot = world.add(built.patch)
                const group = new Group()
                group.add(createLabel(q, r))
                // building a patch shows nothing, only a route does
                group.visible = false
                scene.add(group)

                const entry: LoadedPatch = { slot, group, ground: null, built }
                bySlot.set(slot, entry)
                if (q === 0 && r === 0)
                {
                    show(entry)
                }
                return entry
            }
        )
        loaded.set(key, patch)
    }
    return patch
}


/**
 * Returns the grid positions of all patches up to the given ring around the castle
 */
function rings(radius: number): [number, number][]
{
    const positions: [number, number][] = []
    for (let r = -radius; r <= radius; r++)
    {
        for (let q = -radius; q <= radius; q++)
        {
            positions.push([q, r])
        }
    }
    return positions
}


/**
 * Returns the middle of the given global face in world units, a little above the ground
 */
function faceCenter(face: number): Vector3
{
    const position = [0, 0, 0]
    const center = new Vector3(0, LINE_HEIGHT, 0)
    for (let i = 0; i < 4; i++)
    {
        world.position(face * 4 + i, position)
        center.x += position[0] * SCALE / 4
        center.z += position[1] * SCALE / 4
    }
    return center
}


/**
 * Material for what has to stay visible behind trees and houses
 */
function overlayMaterial(color: string): MeshBasicMaterial
{
    return new MeshBasicMaterial({ color, depthTest: false, transparent: true })
}


function createMarker(position: Vector3, color: string): Mesh
{
    const marker = new Mesh(new SphereGeometry(MARKER_SIZE, 16, 12), overlayMaterial(color))
    marker.position.copy(position)
    marker.renderOrder = 12
    markers.push(marker)
    return marker
}


/**
 * Creates flat bars from face to face. Plain lines would only be one pixel wide.
 */
function createPath(path: number[], color: string): Group
{
    const group = new Group()
    const geometry = new BoxGeometry(1, 0.01, 1)
    const material = overlayMaterial(color)
    let prev = faceCenter(path[0])
    for (let i = 1; i < path.length; i++)
    {
        const curr = faceCenter(path[i])
        const bar = new Mesh(geometry, material)
        bar.position.copy(prev).add(curr).multiplyScalar(0.5)
        bar.userData.length = prev.distanceTo(curr)
        bar.rotation.y = -Math.atan2(curr.z - prev.z, curr.x - prev.x)
        bar.renderOrder = 10
        bars.push(bar)
        group.add(bar)
        prev = curr
    }
    return group
}


/**
 * Creates the outline of a patch
 */
function createOutline({ slot }: LoadedPatch, color: string): LineSegments
{
    const { border } = world.getPatch(slot)
    const lines: number[] = []
    const start = [0, 0, 0]
    const end = [0, 0, 0]
    for (let off = 0; off < border.length; off += BORDER_STRIDE)
    {
        for (const h of [border[off + BORDER_FIRST], border[off + BORDER_SECOND]])
        {
            world.position((slot << SLOT_SHIFT) | h, start)
            world.position((slot << SLOT_SHIFT) | next(h), end)
            lines.push(
                start[0] * SCALE, LINE_HEIGHT, start[1] * SCALE,
                end[0] * SCALE, LINE_HEIGHT, end[1] * SCALE
            )
        }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(lines, 3))
    const outline = new LineSegments(geometry, new LineBasicMaterial({ color, depthTest: false, transparent: true }))
    outline.renderOrder = 11
    return outline
}


/**
 * Sizes the route for the current camera distance
 */
function scaleOverlay(): void
{
    const scale = Math.max(1, camera.position.distanceTo(controls.target) / ROUTE_SCALE_DISTANCE)
    const width = LINE_WIDTH * scale
    for (const bar of bars)
    {
        // a little longer than from face to face, so the bars close the corners
        bar.scale.set(bar.userData.length + width, 1, width)
    }
    for (const marker of markers)
    {
        marker.scale.setScalar(scale)
    }
}


function clearOverlay(): void
{
    bars = []
    markers = []
    if (overlay)
    {
        scene.remove(overlay)
        overlay.traverse(obj => {
            const { geometry, material } = obj as Mesh
            if (geometry)
            {
                geometry.dispose()
                ;(material as Material).dispose()
            }
        })
        overlay = null
    }
}


/**
 * Moves the camera so it sees both given points on the ground
 */
function frame(a: Vector3, b: Vector3): void
{
    const distance = Math.max(a.distanceTo(b), PATCH_DEPTH)
    controls.target.copy(a).add(b).multiplyScalar(0.5).setY(0)
    camera.position.copy(controls.target).add(new Vector3(0, distance * 1.1, distance * 0.7))
}


/**
 * Plans the route of a mission from the castle to the given patch and shows it
 *
 * @param q         q-position of the target patch in the grid
 * @param r         r-position of the target patch in the grid
 * @param known     rings around the castle that count as discovered, the route may also cross what's beyond them
 */
async function plan(q: number, r: number, known: number): Promise<void>
{
    const current = ++generation
    const owner = client
    clearOverlay()
    status.textContent = "Planning " + patchKey(q, r) + " ..."

    const result = await owner.findRoute({
        seed,
        size: FACE_SIZE,
        target: { q, r },
        edits: kindEdits,
        radius: Math.max(known, Math.abs(q), Math.abs(r)) + 1
    })
    if (current !== generation)
    {
        return
    }

    const { reachable, cost } = result
    const isKnown = (pq: number, pr: number) => Math.max(Math.abs(pq), Math.abs(pr)) <= known
    const passed = result.patches.filter(patch => !isKnown(patch.q, patch.r) && !(patch.q === q && patch.r === r))

    // only show the patches the route goes through
    const positions = new Map<string, [number, number]>([[patchKey(q, r), [q, r]]])
    result.patches.forEach(patch => positions.set(patchKey(patch.q, patch.r), [patch.q, patch.r]))
    if (!reachable)
    {
        // no route to show, so show what's in the way: everything between the castle and the target
        for (let pr = Math.min(0, r) - 1; pr <= Math.max(0, r) + 1; pr++)
        {
            for (let pq = Math.min(0, q) - 1; pq <= Math.max(0, q) + 1; pq++)
            {
                positions.set(patchKey(pq, pr), [pq, pr])
            }
        }
    }
    const shown = await Promise.all([...positions.values()].map(([pq, pr]) => load(pq, pr)))
    if (current !== generation)
    {
        return
    }

    const target = await load(q, r)
    const castle = await load(0, 0)
    const paths = result.paths.map(path => unpackPath(world, path))
    const color = reachable ? ROUTE_COLOR : FAILED_COLOR
    const start = globalFace(castle.slot, result.start)

    bySlot.forEach(entry => entry.group.visible = false)
    shown.forEach(show)

    overlay = new Group()
    overlay.add(createOutline(target, TARGET_COLOR))
    for (const patch of passed)
    {
        overlay.add(createOutline(await load(patch.q, patch.r), impressionOf(patch.kind) === "safe" ? SAFE_COLOR : DANGEROUS_COLOR))
    }
    paths.forEach(path => overlay!.add(createPath(path, color)))
    overlay.add(createMarker(faceCenter(start), START_COLOR))
    result.goals.forEach(face => overlay!.add(createMarker(faceCenter(globalFace(target.slot, face)), TARGET_COLOR)))
    paths.forEach(path => overlay!.add(createMarker(faceCenter(path[path.length - 1]), color)))
    scene.add(overlay)

    const faces = Math.max(...paths.map(path => path.length - 1))
    status.textContent = [
        patchKey(q, r) + ": " + result.kind + ", " + result.goals.length + " points of interest, " + known +
        (known === 1 ? " known ring" : " known rings"),
        (reachable ? "route" : "NO ROUTE, closest point") + ": cost " + cost + ", " + faces + " faces",
        "days by speed: " + SPEEDS.map(speed => speed + " -> " + missionDays({ speed }, cost)).join(", ") +
        (reachable ? "" : " (failed)"),
        "passed, still unknown: " + (passed.map(patch => patchKey(patch.q, patch.r) + " looked " + impressionOf(patch.kind)).join(", ") || "none")
    ].join("\n")

    frame(faceCenter(start), new Vector3(q * PATCH_WIDTH, 0, r * PATCH_DEPTH))
    scaleOverlay()
}


function planFromForm(): void
{
    const q = Number(inputQ.value)
    const r = Number(inputR.value)
    const known = inputKnown.value === "" ? 1 : Number(inputKnown.value)
    if (q === 0 && r === 0)
    {
        generation++
        clearOverlay()
        bySlot.forEach(entry => entry.group.visible = entry.slot === world.findSlot(0, 0))
        status.textContent = "0/0 is the castle, where routes start."
        return
    }
    const owner = client
    plan(q, r, known).catch(e => {
        // a new world stops the worker of the old one
        if (owner === client)
        {
            console.error(e)
            status.textContent = "Failed: " + (e instanceof Error ? e.message : e)
        }
    })
}


function newWorld(newSeed: number): void
{
    seed = newSeed
    seedLink.href = "path.html?seed=" + seed
    generation++
    clearOverlay()

    client.terminate()
    client = new MapWorkerClient()
    world = new PatchWorld()
    kindEdits = startEdits(seed)

    bySlot.forEach(entry => {
        scene.remove(entry.group)
        entry.ground?.geometry.dispose()
    })
    bySlot.clear()
    loaded.clear()

    status.textContent = "Castle at 0/0. Only the patches a route goes through get shown."
    rings(START_RINGS).forEach(([q, r]) => load(q, r).catch(e => console.error("Building patch failed", e)))

    camera.position.set(0, PATCH_DEPTH * 3, PATCH_DEPTH * 3.5)
    controls.target.set(0, 0, 0)
}


form.addEventListener("submit", ev => {
    ev.preventDefault()
    planFromForm()
})

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer?.setSize(window.innerWidth, window.innerHeight)
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

if (params.has("q") && params.has("r"))
{
    inputQ.value = params.get("q")!
    inputR.value = params.get("r")!
}

loadModels().then(() => {
    newWorld(seed)
    if (params.has("q") && params.has("r"))
    {
        planFromForm()
    }
    renderer?.setAnimationLoop(() => {
        controls.update()
        scaleOverlay()

        // keep the shadowed area around the point the camera looks at, moving in whole units against shimmering
        const { target } = controls
        sun.target.position.set(Math.round(target.x), 0, Math.round(target.z))
        sun.position.copy(sun.target.position).add(sunOffset)

        renderer.render(scene, camera)
    })
})
