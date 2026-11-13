import Prando from "prando"
import {
    ACESFilmicToneMapping,
    Color,
    HemisphereLight,
    PerspectiveCamera,
    Plane,
    Raycaster,
    Scene,
    Spherical,
    Vector2,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { faceCenter } from "../map/dungeonLights"
import { entranceRoom, EXIT_HALF_SIZE, EXIT_REACH, type LevelExit } from "../map/dungeonRoles"
import { createFloorWalls, entranceFace, type FloorSpot, type FloorWalls, moveOnFloor, seesAcross } from "../map/dungeonWays"
import { fixtureSegments } from "../map/fixtures"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "../map/generateDungeon"
import { actionDuration, itemAnimation } from "../items/itemAnimation"
import { loadItems } from "../items/itemSprite"
import MeepleCrowd, { type Meeple, MEEPLE_MODELS, MEEPLE_SCALE, type MeepleLook, walkSpeedMultiplier } from "../meeple/Meeple3D"
import BruteCrowd from "../monster/BruteCrowd"
import BurstCrowd from "../monster/BurstCrowd"
import Bursts from "../monster/bursts"
import BrutePack, { placeBrutes } from "../monster/brutes"
import CuboidCrowd from "../monster/CuboidCrowd"
import EyeCrowd from "../monster/EyeCrowd"
import EyePack, { placeEyes } from "../monster/eyes"
import CuboidPack, { BIG_CUBOID, mostCuboids, placeCuboids } from "../monster/cuboids"
import Monsters, { HERO_RADIUS, type MonsterFloor, type Prey } from "../monster/monsters"
import { createLevelMeshes, type LevelMeshes } from "../render/dungeonLevel"
import { updateWallCut } from "../render/wallCut"
import LevelSound from "../sound/LevelSound"
import { loadEffect, playEffect } from "../sound/effects"
import { mixer } from "../sound/mixer"
import SoundSpaces from "../sound/soundSpaces"
import HeroMarks, { SLASH_OUTER, SLASH_WIDTH } from "../render/heroMarks"
import { flickerHeroLight, flickerLights, heroBurn, hideHeroLight, moveHeroLight, updateLightField } from "../render/dungeonLighting"
import { FACE_SIZE, loadModels, pixelRatio } from "../render/scene3d"
import { createExitMeshes } from "../render/exitMeshes"
import ChestHoard, { CHEST_HALF_DEPTH, CHEST_HALF_WIDTH, type ChestSpot, COIN_VALUE, type OpenedChests } from "../treasure/chests"
import TreasureView from "../treasure/TreasureView"
import type PatchWorld from "../map/PatchWorld"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { PadAction, PadInput } from "./gamepad"
import HeroControl, { type HeroOrders, NO_ORDERS } from "./heroControl"
import KeySteer, { type KeyInput } from "./keySteer"
import Exploration, { inUnexplored, jumpTargets } from "./exploration"
import { placeFixtures } from "./levelFixtures"

const TAU = Math.PI * 2
const DEG2RAD_FACTOR = TAU / 360;

/**
 * TEMP god mode: with 1, up on the cross kills all monsters in the room of the hero, 0 turns it off
 */
const GOD_MODE = 1
const SMITE_SOUND = "hallelujah-mono.mp3"

/**
 * How far around them in world units a hero gets to know the floor they can see
 */
const VISIT_REACH = 2.5

const AMBIENT = 0.2

/**
 * Most heroes in one level
 */
const MAX_HEROES = 16

/**
 * Walking speed in world units per second for a meeple with a walk speed multiplier of 1
 */
const WALK_SPEED = MEEPLE_SCALE * 1.5

/**
 * Fastest a meeple turns when told where to look, in radians per second
 */
const AIM_TURN_RATE = 30

/**
 * Seconds a meeple takes to follow where they are told to look, which keeps small movements of the stick from twitching them
 */
const AIM_TURN_LAG = 0.06

/**
 * Color of a hero where a wall hides them
 */
const HERO_SILHOUETTE = new Color("#b8ccf4")

/**
 * Room a meeple needs around it on the floor, in world units
 */
const ROOM_AROUND = HERO_RADIUS

/**
 * Hit points a sword takes
 */
const SWORD_DAMAGE = 2

/**
 * Room the biggest monsters on the floor take up, in world units, which keeps them out of narrow places
 */
const BIG_MONSTER_RADIUS = BIG_CUBOID.radius

/**
 * What the screen does for a moment when the hero the view is with gets hurt
 */
const HURT_FLASH = [{ filter: "sepia(1) saturate(5) hue-rotate(-50deg)" }, { filter: "none" }]
const HURT_FLASH_TIME = 250

/**
 * Added to the seed of a level for the coins of its chests, to not get the same numbers as its cuboids
 */
const COIN_SEED = 0x7c3a

const CAMERA_ANGLE = 34
const CAMERA_DISTANCE = 4.5

const CAMERA_RAD = (90 - CAMERA_ANGLE) * DEG2RAD_FACTOR
/**
 * Camera offset from the hero in world units. The view keeps looking from the same side, along VIEW_AWAY, with the walls
 * in front of the hero see-through, so that a direction on the screen always is the same one in the level.
 */
const CAMERA_OFFSET = new Vector3(0, Math.cos(CAMERA_RAD) * CAMERA_DISTANCE,Math.sin(CAMERA_RAD) * CAMERA_DISTANCE)

const MIN_DISTANCE = 1.5
const MAX_DISTANCE = 10

/**
 * Closest the pointer gets to the hero in world units and still tells them where to look. Any closer, and the smallest
 * movement would spin them around.
 */
const POINTER_AIM_REACH = 0.15

/**
 * Longest time in seconds a single frame moves things for
 */
const MAX_FRAME_TIME = 0.1

const FLOOR = new Plane(new Vector3(0, 1, 0), 0)

const hit = new Vector3()
const forward = new Vector3()

/**
 * What heroes can carry into a level
 */
const HERO_ITEMS = ["sword_silver", "shield_silver"] as const

const spot: FloorSpot = { face: 0, x: 0, z: 0 }

const orders: HeroOrders = { ...NO_ORDERS }

/**
 * Hero in the level
 */
export interface LevelHero extends Pick<Meeple, "item" | "leftItem">
{
    id: number
    look: MeepleLook
    /** walking style, see Meeple */
    gait: number
    /** dexterity */
    dex: number
    /** global id of the face to stand on, the entrance without it */
    face?: number
    /** hit points left, none for a hero who lies fallen */
    hp: number
}

interface ShownHero
{
    meeple: Meeple
    /** the face the hero stands on */
    face: number
    /** what the hero does on orders */
    control: HeroControl
    /** moved on orders in the last frame */
    steered: boolean
    /** what the monsters need to know about the hero */
    prey: Prey
    hp: number
    /** when the sword of the attack going on gets there, in seconds, null without one */
    strikeAt: number | null
    /** has the light on */
    lightOn: boolean
    /** seconds the light has been on since it was lit, it goes out after HERO_BURN_TIME */
    lightBurnt: number
    /** face the floor around got visited from last, -1 before */
    visitedFrom: number
}


/**
 * What the map of a level shows, in world units
 */
export interface LevelMapState
{
    world: PatchWorld
    /** slots of the patches of the level */
    slots: readonly number[]
    /** every face that can be walked on */
    floor: ReadonlySet<number>
    exploration: Exploration
    chests: { face: number, x: number, z: number, opened: boolean }[]
    exits: readonly LevelExit[]
    /** rooms with visited floor that the hero can jump to, at the visited face closest to their middle */
    rooms: { face: number, x: number, z: number }[]
    /** the hero the view is with, null without one */
    hero: { x: number, z: number, facing: number } | null
}


/**
 * Turns a meeple the short way toward a facing, by the given radians at most
 *
 * @param share     part of the way to turn by at most, for easing in
 */
function turnToward(meeple: Meeple, facing: number, most: number, share = 1): void
{
    const turn = (((facing - meeple.facing) % TAU + TAU * 1.5) % TAU - Math.PI) * share
    meeple.facing += Math.max(-most, Math.min(most, turn))
}


/**
 * A dungeon level in 3D with the heroes inside. The view stays with one of them, who carries the hero light and goes where
 * a controller or keyboard and mouse steer them. Like the castle scene it has a canvas of its own, which saves the two from knowing about each other's
 * lights and materials.
 */
export default class LevelScene
{
    readonly element: HTMLCanvasElement

    private readonly renderer: WebGLRenderer
    private readonly scene = new Scene()
    private readonly camera: PerspectiveCamera
    private readonly controls: OrbitControls
    private readonly client = new MapWorkerClient()
    private readonly raycaster = new Raycaster()
    private readonly pointer = new Vector2()
    private readonly lookAngles = new Spherical()
    /** ends the listening to the window */
    private readonly listening = new AbortController()

    /** null until the level is there */
    private level: DungeonLevel | null = null
    private meshes: LevelMeshes | null = null
    private floorWalls: FloorWalls | null = null
    /** the walls with the chests, which are in the way without keeping anyone from seeing past them */
    private solidWalls: FloorWalls | null = null
    private chests: ChestHoard | null = null
    private treasure: TreasureView | null = null
    private exits: LevelExit[] = []
    private sound: LevelSound | null = null
    /** the hero the view is with was close enough to take an exit in the last frame */
    private atExit = false
    private crowd: MeepleCrowd | null = null
    private monsters: Monsters | null = null
    private cuboids: CuboidPack | null = null
    private cuboidCrowd: CuboidCrowd | null = null
    private eyes: EyePack | null = null
    private eyeCrowd: EyeCrowd | null = null
    private brutes: BrutePack | null = null
    private bruteCrowd: BruteCrowd | null = null
    private readonly bursts = new Bursts()
    private burstCrowd: BurstCrowd | null = null
    private readonly marks = new HeroMarks()
    private slots: number[] = []
    private entrance = 0
    /** null until the level is there */
    private exploration: Exploration | null = null

    /** every face that can be walked on */
    private floorSet: ReadonlySet<number> = new Set()

    private heroes: LevelHero[] = []
    private readonly shown = new Map<number, ShownHero>()

    /** id of the hero the view stays with */
    private focus: number | null = null
    /** where the view last saw that hero */
    private readonly focusAt = new Vector3()
    /** the camera has to get to the hero first */
    private unplaced = true
    /** what a controller does in the current frame, if it is in charge of the hero the view is with */
    private steering: PadInput | null = null
    /** TEMP god mode: up on the cross was down in the last frame */
    private godHeld = false
    /** what keyboard and mouse tell the hero the view is with, which they do in frames without a controller steering */
    readonly keys = new KeySteer()

    private running = false
    private lastFrame = 0

    /** canvas size the renderer was last set to */
    private width = 0
    private height = 0

    /**
     * @param seed      seed of the level
     * @param onMoved   called when a hero got to a face
     * @param onLeft    called when a hero took an exit
     * @param onHurt    called with the hit points left when a hero got hurt
     * @param onFallen  called when a hero has no hit points left
     * @param opened    what happened to the chests of the level before, gets changed along with them
     * @param onLoot    called when that changed, with the hero and the gold they picked up
     * @param onExitNear called when the hero the view is with got close enough to an exit to take it, or isn't anymore
     * @param explored  where heroes have been before, see Exploration.encode()
     * @param onExplored called with the new Exploration.encode() when heroes got to see more of the level
     */
    constructor(
        seed: number,
        private readonly onMoved: (id: number, face: number) => void,
        private readonly onLeft: (id: number) => void,
        private readonly onHurt: (id: number, hp: number) => void,
        private readonly onFallen: (id: number) => void,
        private readonly opened: OpenedChests,
        private readonly onLoot: (id: number, gold: number) => void,
        private readonly onExitNear: () => void,
        private readonly explored: string | undefined,
        private readonly onExplored: (explored: string) => void
    )
    {
        if (GOD_MODE)
        {
            // TEMP, for it to play right away
            void loadEffect(SMITE_SOUND)
        }

        const canvas = document.createElement("canvas")
        canvas.className = "level-scene"
        this.element = canvas

        const renderer = new WebGLRenderer({ canvas, antialias: true })
        renderer.setPixelRatio(pixelRatio())
        renderer.toneMapping = ACESFilmicToneMapping
        this.renderer = renderer

        this.scene.background = new Color("#050508")
        this.scene.add(new HemisphereLight("#8fa0d0", "#303048", AMBIENT))

        this.camera = new PerspectiveCamera(40, 1, 0.1, 500)

        const controls = new OrbitControls(this.camera, canvas)
        controls.enableDamping = true
        controls.enablePan = false
        controls.minDistance = MIN_DISTANCE
        controls.maxDistance = MAX_DISTANCE
        controls.enableRotate = false
        this.controls = controls

        this.listen(canvas)

        Promise.all([
            this.client.buildDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT, {}, true),
            loadModels([...MEEPLE_MODELS, "acidCuboid", "flyingEye", "brute", "chest", "coin", "stairs"]),
            loadItems(HERO_ITEMS)
        ]).then(
            ([level]) => this.addLevel(level, seed),
            err => console.error("Building level " + seed + " failed", err)
        )
    }

    private addLevel(level: DungeonLevel, seed: number): void
    {
        const meshes = createLevelMeshes(level)
        this.level = level
        this.meshes = meshes
        this.floorWalls = createFloorWalls(meshes.segments, ROOM_AROUND)
        this.scene.add(...meshes.meshes)
        this.slots = level.patches.map((_, slot) => slot)
        this.entrance = entranceFace(meshes.world, level)
        this.floorSet = new Set([...level.rooms.flat(), ...level.corridors.flatMap(({ faces }) => faces)])
        this.exploration = new Exploration(meshes.world, this.slots, this.explored)
        const chests = this.addChests(level, meshes, seed)

        const crowd = new MeepleCrowd(MAX_HEROES)
        crowd.showSilhouettes()
        crowd.setLightField(meshes.field)
        this.scene.add(crowd.group, this.marks.group)
        this.crowd = crowd
        this.addMonsters(level, meshes, seed, chests)
        this.addSound(level, meshes, seed)

        this.setHeroes(this.heroes)
        this.client.terminate()
    }

    private addSound({ rooms, corridors }: DungeonLevel, { world }: LevelMeshes, seed: number): void
    {
        const center = (face: number): [number, number] => faceCenter(world, face)
        const middles = rooms.map(faces => {
            let x = 0, z = 0
            for (const face of faces)
            {
                const [fx, fz] = center(face)
                x += fx
                z += fz
            }
            return [x / faces.length, z / faces.length] as const
        })
        this.sound = new LevelSound(mixer(), new SoundSpaces(rooms, corridors, center), middles, seed)
        this.sound.setRunning(this.running)
    }

    /**
     * Puts the chests into the level
     *
     * @returns the walls of the level with the chests, for whatever has to go around them
     */
    private addChests(level: DungeonLevel, { world, segments, field }: LevelMeshes, seed: number): Float64Array
    {
        const { exits, chests: spots } = placeFixtures(level, world, segments, seed)
        this.exits = exits
        this.scene.add(createExitMeshes(exits, field))

        const solid = Float64Array.of(
            ...segments,
            ...fixtureSegments(spots, CHEST_HALF_WIDTH, CHEST_HALF_DEPTH),
            ...fixtureSegments(exits, EXIT_HALF_SIZE, EXIT_HALF_SIZE)
        )
        this.solidWalls = createFloorWalls(solid, ROOM_AROUND)
        const chests = new ChestHoard(spots, seed + COIN_SEED, (chest, dx, dz) => this.coinLanding(chest, dx, dz), this.opened)
        const treasure = new TreasureView(chests.chests, field)
        this.scene.add(treasure.group)
        this.chests = chests
        this.treasure = treasure
        return solid
    }

    /**
     * Returns where a coin ends up on its way from the front of a chest, which is a place a hero can get to
     */
    private coinLanding({ face, x, z, facing }: ChestSpot, dx: number, dz: number): [number, number]
    {
        const front = CHEST_HALF_DEPTH + ROOM_AROUND * 1.1
        spot.face = face
        spot.x = x + Math.sin(facing) * front
        spot.z = z + Math.cos(facing) * front
        moveOnFloor(this.meshes!.world, this.solidWalls!, spot, dx, dz)
        return [spot.x, spot.z]
    }

    private addMonsters({ rooms, corridors }: DungeonLevel, { world, field }: LevelMeshes, seed: number, solid: Float64Array): void
    {
        const entrance = entranceRoom(rooms, corridors)
        const walls = this.solidWalls!
        const seeing = this.floorWalls!
        const bigWalls = createFloorWalls(solid, BIG_MONSTER_RADIUS)
        const floor: MonsterFloor = {
            // flying ones go over chests
            move: (monster, dx, dz) => moveOnFloor(world, monster.kind.flying ? seeing : monster.kind.big ? bigWalls : walls, monster, dx, dz),
            sees: (x0, z0, x1, z1) => seesAcross(seeing, x0, z0, x1, z1)
        }
        const random = new Prando(seed)

        const cuboids = new CuboidPack(floor)
        // all get placed and those on known floor left out, which keeps the places of the others for the same seed
        const exploration = this.exploration!
        const placed = inUnexplored(placeCuboids(rooms, entrance, random), exploration)
        for (const { face, kind } of placed)
        {
            const [x, z] = faceCenter(world, face)
            cuboids.add(kind, face, x, z)
        }
        const cuboidCrowd = new CuboidCrowd(mostCuboids(placed.map(({ kind }) => kind)), field)
        this.scene.add(cuboidCrowd.group)
        this.cuboids = cuboids
        this.cuboidCrowd = cuboidCrowd

        const eyes = new EyePack(floor)
        const eyesPlaced = inUnexplored(placeEyes(rooms, entrance, random), exploration)
        for (const { face, kind } of eyesPlaced)
        {
            const [x, z] = faceCenter(world, face)
            eyes.add(kind, face, x, z)
        }
        const eyeCrowd = new EyeCrowd(eyesPlaced.length, field)
        this.scene.add(eyeCrowd.group)
        this.eyes = eyes
        this.eyeCrowd = eyeCrowd

        // after the others, which keeps their places for the same seed
        const brutes = new BrutePack(floor)
        for (const { face, kind } of inUnexplored(placeBrutes(rooms, entrance, random), exploration))
        {
            const [x, z] = faceCenter(world, face)
            brutes.add(kind, face, x, z)
        }
        const bruteCrowd = new BruteCrowd(field)
        this.scene.add(bruteCrowd.group)
        this.brutes = brutes
        this.bruteCrowd = bruteCrowd

        this.monsters = new Monsters([cuboids, eyes, brutes], floor)
        const burstCrowd = new BurstCrowd(field)
        this.scene.add(burstCrowd.mesh)
        this.burstCrowd = burstCrowd
    }

    /**
     * Sets who is in the level. Someone already there goes on from where they are.
     */
    setHeroes(heroes: LevelHero[]): void
    {
        this.heroes = heroes
        const { crowd, shown, meshes } = this
        if (!crowd || !meshes)
        {
            return
        }
        for (const [id, { meeple }] of shown)
        {
            if (!heroes.some(hero => hero.id === id))
            {
                crowd.remove(meeple)
                shown.delete(id)
            }
        }
        for (const { id, look, gait, dex, face = this.entrance, hp, ...held } of heroes)
        {
            if (!shown.has(id))
            {
                const [x, z] = faceCenter(meshes.world, face)
                const meeple: Meeple = {
                    position: new Vector3(x, 0, z),
                    facing: 0,
                    look,
                    phase: id,
                    name: "",
                    gait,
                    dex,
                    walking: false,
                    // the shield only comes up to block
                    ready: !!held.item && hp > 0,
                    leftReady: false,
                    silhouette: HERO_SILHOUETTE,
                    fallen: hp === 0,
                    ...held
                }
                crowd.add(meeple)
                shown.set(id, {
                    meeple,
                    face,
                    control: new HeroControl(held.item ? actionDuration(itemAnimation(held.item).action) : null, !!held.leftItem),
                    steered: false,
                    prey: { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0 },
                    hp,
                    strikeAt: null,
                    lightOn: true,
                    lightBurnt: 0,
                    visitedFrom: -1
                })
            }
        }
    }

    /**
     * Binds the view to the hero with the given id
     */
    setFocus(id: number): void
    {
        if (id !== this.focus)
        {
            this.focus = id
            this.unplaced = true
        }
    }

    /**
     * Returns whether a monster can see the hero with the given id, which keeps the days from going on
     */
    inFight(id: number): boolean
    {
        const hero = this.shown.get(id)
        return !!hero && hero.hp > 0 && !!this.monsters?.sees(hero.prey)
    }

    /**
     * Tells what a controller does in this frame to the hero the view is with. In frames without this, they do what
     * keyboard and mouse tell them.
     */
    steer(input: PadInput): void
    {
        this.steering = input
        // TEMP god mode, once per press
        if (GOD_MODE && input.godKill && !this.godHeld)
        {
            this.godKill()
        }
        this.godHeld = input.godKill
    }

    /**
     * TEMP god mode: kills all monsters in the room of the hero the view is with
     */
    private godKill(): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero)
        {
            return
        }
        // the hero smites, whether there is anything to smite or not
        playEffect(SMITE_SOUND)
        const room = this.level?.rooms.find(faces => faces.includes(hero.face))
        if (room)
        {
            this.monsters?.smiteOn(new Set(room))
        }
    }

    /**
     * Has the hero the view is with do what the buttons on the face of the controller stand for in a level. The ones that do
     * nothing yet are kept for more of this.
     */
    act(action: PadAction): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero || hero.hp === 0)
        {
            return
        }
        if (action === "map")
        {
            hero.lightOn = !hero.lightOn
            hero.lightBurnt = 0
        }
        else if (action === "confirm")
        {
            const { position } = hero.meeple
            const chest = this.chests?.closedNear(position.x, position.z)
            if (chest)
            {
                this.chests!.open(chest, performance.now() / 1000)
                this.onLoot(this.focus!, 0)
            }
            else if (this.nearExit(this.focus!))
            {
                this.onLeft(this.focus!)
            }
        }
    }

    /**
     * Returns whether the hero with the given id is close enough to an exit to take it
     */
    nearExit(id: number): boolean
    {
        const hero = this.shown.get(id)
        return !!hero && hero.hp > 0 && this.exits.some(({ x, z }) => Math.hypot(x - hero.meeple.position.x, z - hero.meeple.position.z) <= EXIT_REACH)
    }

    /**
     * Returns whether the hero with the given id is close enough to a closed chest to open it
     */
    nearChest(id: number): boolean
    {
        const hero = this.shown.get(id)
        return !!hero && hero.hp > 0 && !!this.chests?.closedNear(hero.meeple.position.x, hero.meeple.position.z)
    }

    /**
     * Has a hero do what they are told
     *
     * @param given     their orders, null for a hero nobody steers
     */
    private steerHero(id: number, hero: ShownHero, given: HeroOrders | null, time: number, delta: number): void
    {
        const { meeple, control } = hero
        const attacks = control.update(given ?? NO_ORDERS, delta, meeple.facing)
        if (attacks)
        {
            this.crowd!.act(meeple, 0)
            // comes with the blade, after it has been drawn back
            hero.strikeAt = time + itemAnimation(meeple.item!).action.steps[0].transition.duration
            this.marks.slash(hero.strikeAt)
        }
        meeple.leftReady = control.blocking
        if (control.turnTo !== null)
        {
            turnToward(meeple, control.turnTo, AIM_TURN_RATE * delta, 1 - Math.exp(-delta / AIM_TURN_LAG))
        }

        if (control.moving)
        {
            const speed = WALK_SPEED * walkSpeedMultiplier(meeple) * delta
            spot.face = hero.face
            spot.x = meeple.position.x
            spot.z = meeple.position.z
            moveOnFloor(this.meshes!.world, this.solidWalls!, spot, control.velocityX * speed, control.velocityZ * speed)
            hero.face = spot.face
            meeple.position.set(spot.x, 0, spot.z)
            meeple.walking = true
            hero.steered = true
        }
        else if (hero.steered)
        {
            hero.steered = false
            meeple.walking = false
            this.onMoved(id, hero.face)
        }
    }

    /**
     * Returns what a controller's input tells a hero to do, with the directions turned from the screen into the world
     */
    private ordersOf({ moveX, moveY, aimX, aimY, dash, attack, block }: PadInput): HeroOrders
    {
        this.moveOrders(moveX, moveY)
        const heading = this.controls.getAzimuthalAngle()
        const cos = Math.cos(heading), sin = Math.sin(heading)
        orders.aimX = aimX * cos + aimY * sin
        orders.aimZ = -aimX * sin + aimY * cos
        orders.dash = dash
        orders.attack = attack
        orders.block = block
        return orders
    }

    /**
     * Returns what keyboard and mouse tell a hero to do: to go where the keys point on the screen, and to look at the floor
     * under the pointer
     */
    private keyOrders({ moveX, moveY, dash, attack, block, pointerX, pointerY }: KeyInput, { meeple }: ShownHero): HeroOrders
    {
        this.moveOrders(moveX, moveY)
        orders.aimX = 0
        orders.aimZ = 0
        if (pointerX !== null && pointerY !== null)
        {
            const rect = this.element.getBoundingClientRect()
            this.pointer.set(
                (pointerX - rect.left) / rect.width * 2 - 1,
                -(pointerY - rect.top) / rect.height * 2 + 1
            )
            this.raycaster.setFromCamera(this.pointer, this.camera)
            if (this.raycaster.ray.intersectPlane(FLOOR, hit))
            {
                const dx = hit.x - meeple.position.x
                const dz = hit.z - meeple.position.z
                if (Math.hypot(dx, dz) > POINTER_AIM_REACH)
                {
                    orders.aimX = dx
                    orders.aimZ = dz
                }
            }
        }
        orders.dash = dash
        orders.attack = attack
        orders.block = block
        return orders
    }

    /**
     * Sets where the orders tell to go, from a direction on the screen
     */
    private moveOrders(moveX: number, moveY: number): void
    {
        const heading = this.controls.getAzimuthalAngle()
        const cos = Math.cos(heading), sin = Math.sin(heading)
        orders.moveX = moveX * cos + moveY * sin
        orders.moveZ = -moveX * sin + moveY * cos
    }

    private updateHeroes(time: number, delta: number): void
    {
        const { steering } = this
        this.steering = null
        const focused = this.focus !== null ? this.shown.get(this.focus) : undefined
        // a controller always shows where the hero looks, the mouse only while it tells them
        let aiming = !!steering
        for (const [id, hero] of this.shown)
        {
            if (hero.hp === 0)
            {
                continue
            }
            let given: HeroOrders | null = null
            if (hero === focused)
            {
                given = steering ? this.ordersOf(steering) : this.keyOrders(this.keys.input(), hero)
                aiming ||= given.aimX !== 0 || given.aimZ !== 0
            }
            this.steerHero(id, hero, given, time, delta)
        }
        this.updateExploration()
        this.updateMonsters(time, delta)
        this.updateTreasure(time)
        this.crowd?.update(this.camera, time)

        if (focused)
        {
            const { position, facing } = focused.meeple
            this.marks.update(position.x, position.z, facing, aiming, time)
        }
        const atExit = this.focus !== null && this.nearExit(this.focus)
        if (atExit !== this.atExit)
        {
            this.atExit = atExit
            this.onExitNear()
        }
    }

    /**
     * Has the heroes get to know the floor around them whenever they got to another face
     */
    private updateExploration(): void
    {
        let changed = false
        for (const hero of this.shown.values())
        {
            const { face } = hero
            if (face !== hero.visitedFrom)
            {
                hero.visitedFrom = face
                changed = this.visitAround(face, hero.meeple.position.x, hero.meeple.position.z) || changed
            }
        }
        if (changed)
        {
            this.onExplored(this.exploration!.encode())
        }
    }

    /**
     * Visits the floor faces within reach of a point that can be seen from it, going from face to face from the one it is on
     *
     * @returns true if any of them weren't visited before
     */
    private visitAround(from: number, x: number, z: number): boolean
    {
        const { world } = this.meshes!
        const exploration = this.exploration!
        let changed = exploration.visit(from)
        const seen = new Set([from])
        const open = [from]
        while (open.length)
        {
            const face = open.pop()!
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                const twin = world.twin(h)
                const next = twin >> 2
                if (twin < 0 || seen.has(next))
                {
                    continue
                }
                seen.add(next)
                if (!this.floorSet.has(next))
                {
                    continue
                }
                const [nx, nz] = faceCenter(world, next)
                if (Math.hypot(nx - x, nz - z) <= VISIT_REACH && seesAcross(this.floorWalls!, x, z, nx, nz))
                {
                    changed = exploration.visit(next) || changed
                    open.push(next)
                }
            }
        }
        return changed
    }

    /**
     * Returns whether there is nothing left to find in the level: heroes have been everywhere, which also means no monsters
     * come back, and all the treasure is gone. False until the level is there.
     */
    spent(): boolean
    {
        const { exploration, chests } = this
        return !!exploration && !!chests && chests.empty && exploration.hasAll(this.floorSet)
    }

    /**
     * Returns what the map of the level shows, null until the level is there
     */
    mapState(): LevelMapState | null
    {
        const { meshes, exploration, chests } = this
        if (!meshes || !exploration || !chests)
        {
            return null
        }
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        return {
            world: meshes.world,
            slots: this.slots,
            floor: this.floorSet,
            exploration,
            chests: chests.chests.map(({ face, x, z, openedAt }) => ({ face, x, z, opened: openedAt !== null })),
            exits: this.exits,
            rooms: hero ? this.jumpTargets(hero) : [],
            hero: hero ? { x: hero.meeple.position.x, z: hero.meeple.position.z, facing: hero.meeple.facing } : null
        }
    }

    /**
     * Returns where in the rooms with visited floor the given hero can jump to, leaving out the room they are in
     */
    private jumpTargets(hero: ShownHero): LevelMapState["rooms"]
    {
        const at = hero.face
        return jumpTargets(this.meshes!.world, this.level!.rooms, this.exploration!, at)
    }

    /**
     * Puts the hero the view is with right onto a visited face of a room, out of a fight only
     *
     * @returns whether the hero got there
     */
    jumpTo(face: number): boolean
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero || hero.hp === 0 || !this.meshes || this.monsters?.sees(hero.prey) || !this.jumpTargets(hero).some(target => target.face === face))
        {
            return false
        }
        const [x, z] = faceCenter(this.meshes.world, face)
        hero.face = face
        hero.steered = false
        hero.meeple.position.set(x, 0, z)
        hero.meeple.walking = false
        hero.prey.x = x
        hero.prey.z = z
        this.unplaced = true
        this.onMoved(this.focus!, face)
        return true
    }

    private updateMonsters(time: number, delta: number): void
    {
        const { monsters, shown } = this
        if (!monsters)
        {
            return
        }
        // the fallen are no prey anymore
        const heroes = [...shown.entries()].filter(([, hero]) => hero.hp > 0)
        for (const [, { meeple, control, prey }] of heroes)
        {
            prey.x = meeple.position.x
            prey.z = meeple.position.z
            prey.facing = meeple.facing
            prey.blocking = control.blocking
            prey.dodging = control.dodging
        }
        monsters.update(delta, heroes.map(([, { prey }]) => prey))

        for (const [id, hero] of heroes)
        {
            const { prey, strikeAt } = hero
            if (strikeAt !== null && time >= strikeAt)
            {
                hero.strikeAt = null
                monsters.strike(prey.x, prey.z, prey.facing, SLASH_OUTER, SLASH_WIDTH, SWORD_DAMAGE)
            }
            const damage = monsters.hurt(prey, delta)
            if (damage > 0)
            {
                this.hurtHero(id, hero, damage)
            }
        }
        this.cuboidCrowd!.update(this.cuboids!.members, time)
        const eyes = this.eyes!
        this.eyeCrowd!.update(eyes.members, eyes.bolts, eyes.sparks, time)
        this.bruteCrowd!.update(this.brutes!.members, delta)

        const { bursts } = this
        for (const pack of monsters.packs)
        {
            for (const death of pack.deaths.splice(0))
            {
                bursts.add(death)
            }
        }
        bursts.update(delta)
        this.burstCrowd!.update(bursts.particles)
    }

    /**
     * Has the heroes pick up the coins they walk over, each for themselves
     */
    private updateTreasure(time: number): void
    {
        const { chests, treasure } = this
        if (!chests)
        {
            return
        }
        for (const [id, { meeple: { position }, hp }] of this.shown)
        {
            if (hp === 0)
            {
                continue
            }
            const taken = chests.collect(position.x, position.z, time)
            if (taken > 0)
            {
                this.onLoot(id, taken * COIN_VALUE)
            }
        }
        treasure!.update(time)
    }

    private hurtHero(id: number, hero: ShownHero, damage: number): void
    {
        hero.hp = Math.max(0, hero.hp - damage)
        if (id === this.focus)
        {
            this.element.animate(HURT_FLASH, HURT_FLASH_TIME)
        }
        if (hero.hp === 0)
        {
            const { meeple } = hero
            meeple.fallen = true
            meeple.walking = false
            meeple.ready = meeple.leftReady = false
            hero.strikeAt = null
            this.onFallen(id)
        }
        else
        {
            this.onHurt(id, hero.hp)
        }
    }

    /**
     * Moves the view along with the hero, and burns down their light
     */
    private updateView(time: number, delta: number): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero)
        {
            return
        }
        const { position } = hero.meeple
        const { camera, controls, focusAt, meshes } = this
        if (this.unplaced)
        {
            this.unplaced = false
            controls.target.copy(position)
            camera.position.copy(position).add(CAMERA_OFFSET)
        }
        else
        {
            camera.position.add(hit.subVectors(position, focusAt))
            controls.target.add(hit)
        }
        focusAt.copy(position)
        // only the space the hero is in: a space next to it has the wall the hero looks at as its near wall
        const space = meshes!.near.spaceOf.get(hero.face)
        updateWallCut(meshes!.cut, space ? [space] : [], delta)
        if (hero.lightOn)
        {
            hero.lightBurnt += delta
            const burn = heroBurn(hero.lightBurnt)
            hero.lightOn = burn > 0
            moveHeroLight(meshes!.field, meshes!.segments, position.x, position.z)
            flickerHeroLight(meshes!.field, time, burn)
        }
        else
        {
            hideHeroLight(meshes!.field)
        }
    }

    /**
     * Feeds the mouse to what steers the hero. The buttons only count when they go down on the level itself, and wherever
     * they come up again.
     */
    private listen(canvas: HTMLCanvasElement): void
    {
        const { keys } = this
        canvas.addEventListener("pointerdown", ev => {
            keys.point(ev.clientX, ev.clientY)
            keys.button(ev.button, true)
        })
        // the right button blocks
        canvas.addEventListener("contextmenu", ev => ev.preventDefault())

        const { signal } = this.listening
        window.addEventListener("pointermove", ev => keys.point(ev.clientX, ev.clientY), { signal })
        window.addEventListener("pointerup", ev => keys.button(ev.button, false), { signal })
        window.addEventListener("pointercancel", () => keys.release(), { signal })
        window.addEventListener("blur", () => keys.release(), { signal })
    }

    /**
     * Has the hero the view is with listen, with left and right as on screen
     */
    private updateSound(): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero || !this.sound)
        {
            return
        }
        const { position } = hero.meeple
        this.camera.getWorldDirection(forward)
        const length = Math.hypot(forward.x, forward.z) || 1
        const face = hero.face
        this.sound.listen(face, position.x, position.z, forward.x / length, forward.z / length)
    }

    private resize(): void
    {
        const { clientWidth, clientHeight } = this.element
        if (clientWidth && clientHeight && (clientWidth !== this.width || clientHeight !== this.height))
        {
            this.width = clientWidth
            this.height = clientHeight
            this.renderer.setSize(clientWidth, clientHeight, false)
            this.camera.aspect = clientWidth / clientHeight
            this.camera.updateProjectionMatrix()
        }
    }

    /**
     * Moves the camera closer to what it looks at or further away, by the factor that CastleScene.look() takes. The
     * side it looks from stays.
     */
    zoom(zoom: number): void
    {
        const { camera, controls, lookAngles } = this
        lookAngles.setFromVector3(hit.copy(camera.position).sub(controls.target))
        lookAngles.radius *= zoom
        lookAngles.makeSafe()
        camera.position.setFromSpherical(lookAngles).add(controls.target)
    }

    /**
     * Starts or stops rendering, e.g. while the view is hidden
     */
    setRunning(running: boolean): void
    {
        if (running === this.running)
        {
            return
        }
        this.running = running
        if (!running)
        {
            this.keys.release()
        }
        this.sound?.setRunning(running)
        this.lastFrame = performance.now() / 1000
        this.renderer.setAnimationLoop(running ? () => {
            const time = performance.now() / 1000
            const delta = Math.min(MAX_FRAME_TIME, time - this.lastFrame)
            this.lastFrame = time
            this.resize()
            const { level, meshes } = this
            if (level && meshes)
            {
                this.updateHeroes(time, delta)
                this.updateView(time, delta)
                this.updateSound()
                flickerLights(meshes.field, level.lighting!.lights, time)
                updateLightField(this.renderer, meshes.field)
            }
            this.controls.update()
            this.renderer.render(this.scene, this.camera)
        } : null)
    }

    /**
     * Stops rendering and frees the renderer and the map worker
     */
    dispose(): void
    {
        this.setRunning(false)
        this.sound?.dispose()
        this.controls.dispose()
        this.listening.abort()
        this.client.terminate()
        this.renderer.dispose()
        this.renderer.forceContextLoss()
        this.element.remove()
    }
}
