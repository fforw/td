import "./style.css"
import {
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    MeshStandardMaterial,
    PCFShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    Timer,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import MeepleCrowd, { HairStyle, MEEPLE_SCALE, type MeepleLook } from "./Meeple3D"
import { randomSeed, resetRandom, rng } from "./util"

const TAU = Math.PI * 2

/**
 * Meeples per row and column of the test grid, like the 2D sprite sheet
 */
const GRID = 7
const SPACING = MEEPLE_SCALE * 1.5

const SKINS = ["#f0c8aa", "#d9a07e", "#a86a48", "#6a3e24"]
const HAIR = ["#e8865a", "#f0d050", "#8a5a28", "#22182c"]
const SHIRTS = ["#a01828", "#1a78b0", "#8c2898", "#187830", "#3a8c8c", "#8c8c8c", "#d0a838"]

function pick<T>(array: T[]): T
{
    return array[rng.nextInt(0, array.length - 1)]
}

function randomLook(): MeepleLook
{
    return {
        skin: new Color(pick(SKINS)),
        shirt: new Color(pick(SHIRTS)),
        hair: new Color(pick(HAIR)),
        hairStyle: pick([HairStyle.CURLY, HairStyle.CURLY, HairStyle.SHORT, HairStyle.BALD]),
        height: rng.next()
    }
}


const canvas = document.getElementById("screen") as HTMLCanvasElement

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap

const scene = new Scene()
scene.background = new Color("#a9c8e8")

// same field of view and viewing angle as the castle view
const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100)
const radius = GRID * SPACING * 0.75
camera.position.set(0, radius * 1.1, radius * 1.3)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47

scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))

const sun = new DirectionalLight("#fff4e0", 2.5)
sun.position.set(-radius, radius * 1.5, radius * 0.6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.01
const shadowCam = sun.shadow.camera
shadowCam.left = shadowCam.bottom = -radius
shadowCam.right = shadowCam.top = radius
shadowCam.updateProjectionMatrix()
scene.add(sun)

const ground = new Mesh(new PlaneGeometry(radius * 6, radius * 6), new MeshStandardMaterial({ color: "#5c9e3c", roughness: 1 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

resetRandom(randomSeed())

const crowd = new MeepleCrowd(GRID * GRID)
const offset = (GRID - 1) * SPACING / 2
for (let y = 0; y < GRID; y++)
{
    for (let x = 0; x < GRID; x++)
    {
        crowd.add({
            position: new Vector3(x * SPACING - offset, 0, y * SPACING - offset),
            facing: 0,
            look: randomLook(),
            phase: rng.next() * TAU
        })
    }
}
scene.add(crowd.group)


// controls to compare the tricks

const ui = document.getElementById("ui")!
ui.style.cssText = "position:absolute;top:8px;left:8px;padding:8px;background:#000a;font:12px monospace;display:grid;gap:4px"

function slider(label: string, max: number, get: () => number, set: (v: number) => void): void
{
    const row = document.createElement("label")
    row.textContent = label + " "
    const input = document.createElement("input")
    input.type = "range"
    input.min = "0"
    input.max = String(max)
    input.step = "0.01"
    input.value = String(get())
    input.addEventListener("input", () => set(+input.value))
    row.append(input)
    ui.append(row)
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): void
{
    const row = document.createElement("label")
    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = get()
    input.addEventListener("change", () => set(input.checked))
    row.append(input, " " + label)
    ui.append(row)
}

slider("lean", 0.8, () => crowd.lean, v => crowd.lean = v)
slider("head tilt", 0.8, () => crowd.headTilt, v => crowd.headTilt = v)
checkbox("outlines", () => crowd.outlinesVisible, v => crowd.outlinesVisible = v)

const FACING_MODES = ["camera", "random", "spin"]

let facingMode = 0
const facingButton = document.createElement("button")
facingButton.addEventListener("click", () => setFacingMode((facingMode + 1) % FACING_MODES.length))
ui.append(facingButton)
checkbox("walk", () => crowd.walking, v => crowd.walking = v)

function setFacingMode(mode: number): void
{
    facingMode = mode
    facingButton.textContent = "facing: " + FACING_MODES[mode]
    crowd.meeples.forEach(m => m.facing = mode === 1 ? rng.next() * TAU : 0)
}

// e.g. ?facing=random&walk
const params = new URLSearchParams(location.search)
setFacingMode(Math.max(0, FACING_MODES.indexOf(params.get("facing") ?? "")))
crowd.walking = params.has("walk")


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

const viewDirection = new Vector3()
const timer = new Timer()
renderer.setAnimationLoop(t => {
    timer.update(t)
    const time = timer.getElapsed()
    if (facingMode === 2)
    {
        crowd.meeples.forEach((m, i) => m.facing = time * 0.8 + i * 0.3)
    }
    else if (facingMode === 0)
    {
        // all face against the view direction, like the 2D sprites. Turning each toward the camera position looks
        // like a sideways glance near the screen edges.
        const view = camera.getWorldDirection(viewDirection)
        const facing = Math.atan2(-view.x, -view.z)
        crowd.meeples.forEach(m => m.facing = facing)
    }
    controls.update()
    crowd.update(camera, time)
    renderer.render(scene, camera)
})
