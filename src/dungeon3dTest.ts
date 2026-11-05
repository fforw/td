import "./style.css"
import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { loadLevel } from "./dungeonPage"
import type { DungeonLevel } from "./map/generateDungeon"
import PatchWorld from "./map/PatchWorld"
import { createGround } from "./render/patchMeshes"
import { SCALE } from "./render/scene3d"

/*
 * Test page for a dungeon level in 3D, e.g. dungeon3d.html?seed=1&width=3&height=2&floor=0.5&labyrinth=5
 */

const level = loadLevel()

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


function show({ patches }: DungeonLevel): void
{
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    slots.forEach(slot => scene.add(createGround(world, slot)))

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
    const centerX = (minX + maxX) / 2 * SCALE
    const centerZ = (minY + maxY) / 2 * SCALE
    const size = Math.max(maxX - minX, maxY - minY) * SCALE
    controls.target.set(centerX, 0, centerZ)
    camera.position.set(centerX, size * 1.1, centerZ + size * 0.6)
}


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

level.then(level => {
    show(level)
    renderer.setAnimationLoop(() => {
        controls.update()
        renderer.render(scene, camera)
    })
})
