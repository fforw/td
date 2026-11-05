import "./style.css"
import {
    BufferGeometry,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    PerspectiveCamera,
    Scene,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH } from "./map/generateDungeon"
import { FaceType } from "./map/geometry"
import PatchWorld from "./map/PatchWorld"
import { BORDER_FIRST, BORDER_SECOND, BORDER_STRIDE, faceCount, next, type QuadPatch } from "./map/QuadPatch"
import { randomSeed } from "./math/random"
import { createGround } from "./render/patchMeshes"
import { FACE_SIZE, SCALE } from "./render/scene3d"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the patches of a dungeon level, e.g. dungeon.html?seed=1&width=3&height=2
 */

/**
 * Radius of the placeholder disc in faces. All faces start out as NONE, so without it the level would be empty.
 */
const DISC_RADIUS = 12

const OUTLINE_COLOR = "#e0a040"

/**
 * Height of the patch outlines above the ground, in world units
 */
const OUTLINE_HEIGHT = 0.02

const params = new URLSearchParams(location.search)

const seed = randomSeed(params.has("seed") ? Number(params.get("seed")) : null)

function sizeParam(name: string, fallback: number): number
{
    return Math.max(1, Math.floor(Number(params.get(name) ?? fallback)) || fallback)
}

const width = sizeParam("width", DUNGEON_WIDTH)
const height = sizeParam("height", DUNGEON_HEIGHT)

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new Scene()
scene.background = new Color("#14141c")
scene.add(new HemisphereLight("#dfefff", "#404050", 1.6))

const sun = new DirectionalLight("#fff4e0", 2.5)
sun.position.set(-1, 1.5, 0.6)
scene.add(sun)

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.screenSpacePanning = false


/**
 * Returns the center of a face in map units
 */
function faceCenter({ positions, vertex }: QuadPatch, face: number): [number, number]
{
    let x = 0, y = 0
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        x += positions[vertex[h] * 3] / 4
        y += positions[vertex[h] * 3 + 1] / 4
    }
    return [x, y]
}


/**
 * Creates the outline of a patch along its border half edges
 */
function createOutline({ border, positions, vertex }: QuadPatch): LineSegments
{
    const points: number[] = []
    const addHalfEdge = (h: number) => {
        for (const v of [vertex[h] * 3, vertex[next(h)] * 3])
        {
            points.push(positions[v] * SCALE, OUTLINE_HEIGHT, positions[v + 1] * SCALE)
        }
    }

    for (let off = 0; off < border.length; off += BORDER_STRIDE)
    {
        addHalfEdge(border[off + BORDER_FIRST])
        addHalfEdge(border[off + BORDER_SECOND])
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3))
    return new LineSegments(geometry, new LineBasicMaterial({ color: OUTLINE_COLOR }))
}


function show(patches: QuadPatch[]): void
{
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { positions } of patches)
    {
        for (let i = 0; i < positions.length; i += 3)
        {
            minX = Math.min(minX, positions[i])
            maxX = Math.max(maxX, positions[i])
            minY = Math.min(minY, positions[i + 1])
            maxY = Math.max(maxY, positions[i + 1])
        }
    }
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    for (const patch of patches)
    {
        for (let f = 0; f < faceCount(patch); f++)
        {
            const [x, y] = faceCenter(patch, f)
            if (Math.hypot(x - centerX, y - centerY) < DISC_RADIUS * FACE_SIZE)
            {
                patch.faceType[f] = FaceType.PAVED.index
            }
        }
    }

    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    slots.forEach(slot => scene.add(createGround(world, slot)))
    patches.forEach(patch => scene.add(createOutline(patch)))

    const size = Math.max(maxX - minX, maxY - minY) * SCALE
    controls.target.set(centerX * SCALE, 0, centerY * SCALE)
    camera.position.set(centerX * SCALE, size * 1.1, centerY * SCALE + size * 0.6)

    const faces = patches.reduce((sum, patch) => sum + faceCount(patch), 0)
    document.getElementById("ui")!.textContent = `seed ${seed}, ${width} x ${height} patches, ${faces} faces`
}


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

new MapWorkerClient().buildDungeon(seed, FACE_SIZE, width, height).then(patches => {
    show(patches)
    renderer.setAnimationLoop(() => {
        controls.update()
        renderer.render(scene, camera)
    })
})
