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
import { entranceRoom, EXIT_HALF_SIZE, EXIT_REACH, findRoomRoles, type LevelExit } from "../map/dungeonRoles"
import { createFloorWalls, entranceFace, type FloorSpot, type FloorWalls, moveOnFloor, seesAcross } from "../map/dungeonWays"
import { fixtureSegments } from "../map/fixtures"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "../map/generateDungeon"
import { actionDuration, itemAnimation } from "../items/itemAnimation"
import { loadItems } from "../items/itemSprite"
import MeepleCrowd, { LEVEL_MEEPLE_SCALE, type Meeple, MEEPLE_MODELS, type MeepleLook, walkSpeedMultiplier } from "../meeple/Meeple3D"
import { FIGURE_SCALE, LEVEL_GROWTH } from "../meeple/figureScale"
import BruteCrowd from "../monster/BruteCrowd"
import BurstCrowd from "../monster/BurstCrowd"
import Bursts from "../monster/bursts"
import BrutePack from "../monster/brutes"
import CuboidCrowd from "../monster/CuboidCrowd"
import EyeCrowd from "../monster/EyeCrowd"
import EyePack from "../monster/eyes"
import CuboidPack, { BIG_CUBOID, mostCuboids } from "../monster/cuboids"
import Monsters, { HERO_RADIUS, type MonsterFloor, type Prey } from "../monster/monsters"
import SoldierCrowd from "../monster/SoldierCrowd"
import SoldierPack from "../monster/soldiers"
import { planSpawns } from "../monster/spawns"
import { createLevelMeshes, type LevelMeshes } from "../render/dungeonLevel"
import { updateWallCut } from "../render/wallCut"
import LevelSound from "../sound/LevelSound"
import { EffectVoices, loadEffect, playEffect } from "../sound/effects"
import { mixer } from "../sound/mixer"
import SoundSpaces from "../sound/soundSpaces"
import HeroMarks, { SLASH_OUTER, SLASH_WIDTH } from "../render/heroMarks"
import { flickerHeroLight, flickerLights, heroBurn, hideHeroLight, moveHeroLight, updateLightField } from "../render/dungeonLighting"
import { FACE_SIZE, loadModels, pixelRatio } from "../render/scene3d"
import { createExitMeshes } from "../render/exitMeshes"
import ChestHoard, { type Chest, CHEST_HALF_DEPTH, CHEST_HALF_WIDTH, type ChestSpot, COIN_VALUE, type OpenedChests } from "../treasure/chests"
import TreasureView from "../treasure/TreasureView"
import type PatchWorld from "../map/PatchWorld"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { PadAction, PadInput } from "./gamepad"
import HeroControl, { type HeroOrders, NO_ORDERS } from "./heroControl"
import KeySteer, { type KeyInput } from "./keySteer"
import Exploration, { inUnexplored, jumpTargets } from "./exploration"
import { placeFixtures } from "./levelFixtures"
import { randomLook } from "../meeple/look"
import { placeShot, type Shot, SHOTS } from "../scene/sceneCamera"
import ScenePlayer, { type ActorRole, type SceneWorld, type Ware } from "../scene/script"
import SceneStage, { ACT_TIME } from "../scene/stage"
import { placeStranger, STRANGER_REACH, type StrangerSpot, TALK_DISTANCE } from "../scene/stranger"
import { POTION_TIME, traderScript } from "../scene/trader"

const TAU = Math.PI * 2
const DEG2RAD_FACTOR = TAU / 360;

/**
 * TEMP god mode: with 1, up on the cross kills all monsters in the room of the hero, 0 turns it off
 */
export const GOD_MODE = 1
const SMITE_SOUND = "hallelujah-mono.mp3"

/**
 * Sound of a coin getting to the hero, and the gain it plays at
 */
const PICK_UP_SOUND = "pick-up.mp3"
const PICK_UP_VOLUME = 0.85

/**
 * How many pick-up sounds play at once at most, and seconds at least between their starts, so a hero sweeping up a pile
 * hears a quick run of notes instead of one loud chord
 */
const PICK_UP_VOICES = 3
const PICK_UP_GAP = 0.08

/**
 * Playback rates a pick-up sound picks from, so many in a row don't sound the same: the steps of the major pentatonic
 * scale around the sound's own pitch, from a fourth below to a major third above, which sound well in any order
 */
const PICK_UP_RATES = [-5, -3, 0, 2, 4].map(semitones => 2 ** (semitones / 12))

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
const WALK_SPEED = LEVEL_MEEPLE_SCALE * 1.5

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
 * Hit points a sword takes with a strength potion
 */
const STRONG_SWORD_DAMAGE = 4

/**
 * Factor on the walking speed with a speed potion
 */
const SPEED_POTION = 1.5

/**
 * What the trader of a level offers
 */
const TRADER_WARES: readonly Ware[] = ["healing", "speed", "strength", "map"]

/**
 * Height in world units of the tail of a speech bubble, a little above the heads
 */
const BUBBLE_HEIGHT = 0.36 * FIGURE_SCALE

/**
 * Directions tried around the stranger for the mark of the hero in a scene, for all shots to see both from inside the
 * room
 */
const MARK_TRIES = 16

/**
 * Shares of its distance a shot gets pulled in to, for the camera to stay on the near side of the walls
 */
const SHOT_PULLS = [1, 0.75, 0.5, 0.25, 0]

/**
 * Radians the head of a meeple who shakes it turns to each side
 */
const SHAKE_ANGLE = 0.5

/**
 * Times a meeple who shakes their head turns it to each side
 */
const SHAKES = 3

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
const CAMERA_DISTANCE = 4.5 / LEVEL_GROWTH

const CAMERA_RAD = (90 - CAMERA_ANGLE) * DEG2RAD_FACTOR
/**
 * Camera offset from the hero in world units. The view keeps looking from the same side, along VIEW_AWAY, with the walls
 * in front of the hero see-through, so that a direction on the screen always is the same one in the level.
 */
const CAMERA_OFFSET = new Vector3(0, Math.cos(CAMERA_RAD) * CAMERA_DISTANCE,Math.sin(CAMERA_RAD) * CAMERA_DISTANCE)

const MIN_DISTANCE = 1.5 / LEVEL_GROWTH
const MAX_DISTANCE = 10 / LEVEL_GROWTH

/**
 * Closest the pointer gets to the hero in world units and still tells them where to look. Any closer, and the smallest
 * movement would spin them around.
 */
const POINTER_AIM_REACH = 0.15 * FIGURE_SCALE

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

/**
 * Facts of a level: a hero bought its map, a hero talked to its stranger to the end
 */
const CHARTED = "charted"
const MET_STRANGER = "metStranger"

/**
 * Counts every face as visited
 */
const EVERYWHERE = { has: () => true }

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
    /** hit points when unhurt */
    maxHp: number
}

/**
 * What a level needs to know beyond itself, for its scenes: the gold the heroes carry, and what the player knows of the
 * glyph language
 */
export interface LevelOutside
{
    gold(id: number): number
    /** takes gold from a hero */
    pay(id: number, gold: number): void
    knows(concept: string): boolean
    learn(concept: string): void
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
    maxHp: number
    /** seconds of level time left on a speed potion */
    speedLeft: number
    /** seconds of level time left on a strength potion */
    strengthLeft: number
}

/**
 * A scene going on in the level
 */
interface Playing
{
    stage: SceneStage
    /** which side of the line the camera is on */
    left: ActorRole
    heroId: number
    hero: ShownHero
    /** the meeple the hero talks to */
    other: Meeple
    /** where the other one faces when they stand still */
    otherFacing: number
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
    /** a hero bought the map, which shows all the floor, and where there is something to find */
    charted: boolean
    /** TEMP god mode: everything is shown, with what it is */
    revealed: boolean
    /** where the stranger stands, once a hero talked to them or the map is revealed, null before */
    stranger: { x: number, z: number } | null
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
    private readonly pickUpSound = new EffectVoices(PICK_UP_SOUND, PICK_UP_VOICES, PICK_UP_GAP)

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
    private soldiers: SoldierPack | null = null
    private soldierCrowd: SoldierCrowd | null = null
    private readonly bursts = new Bursts()
    private burstCrowd: BurstCrowd | null = null
    private readonly marks = new HeroMarks()
    private slots: number[] = []
    private entrance = 0
    /** null until the level is there */
    private exploration: Exploration | null = null
    /** null for a level without one */
    private strangerSpot: StrangerSpot | null = null
    private stranger: Meeple | null = null
    /** the scene going on, null without one */
    private playing: Playing | null = null
    /** what scenes found out or decided, see setFacts() */
    private readonly facts = new Set<string>()
    /** called with all facts when there are new ones */
    onFacts: ((facts: string[]) => void) | null = null
    /** TEMP god mode: the map shows everything, see LevelMapState */
    revealed = false
    private readonly sceneTarget = new Vector3()
    /** the shot of the scene, pulled in where walls are in the way */
    private readonly pulledShot: Shot = { ...SHOTS.two }

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
     * @param onHurt    called with the hit points left when a hero got hurt or healed
     * @param onFallen  called when a hero has no hit points left
     * @param opened    what happened to the chests of the level before, gets changed along with them
     * @param onLoot    called when that changed, with the hero and the gold they picked up
     * @param onExitNear called when the hero the view is with got close enough to an exit to take it, or isn't anymore
     * @param explored  where heroes have been before, see Exploration.encode()
     * @param onExplored called with the new Exploration.encode() when heroes got to see more of the level
     * @param outside   the gold the heroes carry and what the player knows
     * @param onScene   called when a scene started, ended or waits on something else
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
        private readonly onExplored: (explored: string) => void,
        private readonly outside: LevelOutside,
        private readonly onScene: () => void
    )
    {
        if (GOD_MODE)
        {
            // TEMP, for it to play right away
            void loadEffect(SMITE_SOUND)
        }
        void loadEffect(PICK_UP_SOUND)

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
            loadModels([...MEEPLE_MODELS, "acidCuboid", "flyingEye", "brute", "soldier", "chest", "coin", "healthPotion", "speedPotion", "strengthPotion", "stairs"]),
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

        // the stranger takes one more
        const crowd = new MeepleCrowd(MAX_HEROES + 1, LEVEL_MEEPLE_SCALE)
        crowd.showSilhouettes()
        crowd.setLightField(meshes.field)
        this.scene.add(crowd.group, this.marks.group)
        this.crowd = crowd
        this.addStranger(level, meshes, seed)
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

    /**
     * Puts the stranger of the level in the middle of a room
     */
    private addStranger({ rooms, corridors }: DungeonLevel, { world }: LevelMeshes, seed: number): void
    {
        const spot = placeStranger(rooms, entranceRoom(rooms, corridors), face => faceCenter(world, face), seed)
        this.strangerSpot = spot
        if (!spot)
        {
            return
        }
        const [x, z] = faceCenter(world, spot.face)
        const stranger: Meeple = {
            position: new Vector3(x, 0, z),
            facing: 0,
            look: { ...randomLook(), moustache: true },
            phase: seed,
            name: "",
            gait: 0.5,
            walking: false
        }
        this.crowd!.add(stranger)
        this.stranger = stranger
    }

    private addMonsters({ rooms, corridors }: DungeonLevel, { world, field }: LevelMeshes, seed: number, solid: Float64Array): void
    {
        const walls = this.solidWalls!
        const seeing = this.floorWalls!
        const bigWalls = createFloorWalls(solid, BIG_MONSTER_RADIUS)
        const floor: MonsterFloor = {
            // flying ones go over chests
            move: (monster, dx, dz) => moveOnFloor(world, monster.kind.flying ? seeing : monster.kind.big ? bigWalls : walls, monster, dx, dz),
            sees: (x0, z0, x1, z1) => seesAcross(seeing, x0, z0, x1, z1)
        }
        // nothing in the room the heroes come in by, nor in those nobody can get to
        const { depths, mainPath } = findRoomRoles(rooms, corridors)
        const closed = new Set(depths.flatMap((depth, room) => depth === Infinity ? [room] : []))
        closed.add(mainPath[mainPath.length - 1])
        if (this.strangerSpot)
        {
            // the stranger gets to talk in peace
            closed.add(this.strangerSpot.room)
        }
        const plan = planSpawns({ rooms, closed }, new Prando(seed))
        // the plan is the same for the seed, and those on known floor get left out of it
        const spawns = inUnexplored(plan.flatMap(({ spawns }) => spawns), this.exploration!)

        const cuboids = new CuboidPack(floor)
        const eyes = new EyePack(floor)
        const brutes = new BrutePack(floor)
        const soldiers = new SoldierPack(floor)
        for (const spawn of spawns)
        {
            const [x, z] = faceCenter(world, spawn.face)
            switch (spawn.species)
            {
                case "cuboid":
                    cuboids.add(spawn.kind, spawn.face, x, z)
                    break
                case "eye":
                    eyes.add(spawn.kind, spawn.face, x, z)
                    break
                case "brute":
                    brutes.add(spawn.kind, spawn.face, x, z)
                    break
                case "soldier":
                    soldiers.add(spawn.kind, spawn.face, x, z)
                    break
            }
        }

        const cuboidCrowd = new CuboidCrowd(mostCuboids(spawns.flatMap(spawn => spawn.species === "cuboid" ? [spawn.kind] : [])), field)
        const eyeCrowd = new EyeCrowd(spawns.filter(({ species }) => species === "eye").length, field)
        const bruteCrowd = new BruteCrowd(field)
        const soldierCrowd = new SoldierCrowd(field)
        this.scene.add(cuboidCrowd.group, eyeCrowd.group, bruteCrowd.group, soldierCrowd.group)
        this.cuboids = cuboids
        this.cuboidCrowd = cuboidCrowd
        this.eyes = eyes
        this.eyeCrowd = eyeCrowd
        this.brutes = brutes
        this.bruteCrowd = bruteCrowd
        this.soldiers = soldiers
        this.soldierCrowd = soldierCrowd

        this.monsters = new Monsters([cuboids, eyes, brutes, soldiers], floor)
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
        for (const { id, look, gait, dex, face = this.entrance, hp, maxHp, ...held } of heroes)
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
                    visitedFrom: -1,
                    maxHp,
                    speedLeft: 0,
                    strengthLeft: 0
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
        if (GOD_MODE && input.godKill && !this.godHeld && !this.playing)
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
        if (!hero || hero.hp === 0 || this.playing)
        {
            return
        }
        if (action === "endDay")
        {
            hero.lightOn = !hero.lightOn
            hero.lightBurnt = 0
        }
        else if (action === "confirm")
        {
            const chest = this.chestNear(hero)
            if (chest)
            {
                this.chests!.open(chest, performance.now() / 1000)
                this.onLoot(this.focus!, 0)
            }
            else if (this.nearStranger(this.focus!))
            {
                this.startScene(this.focus!, hero)
            }
            else if (this.nearExit(this.focus!))
            {
                this.onLeft(this.focus!)
            }
        }
    }

    /**
     * Returns whether the hero with the given id is close enough to the stranger to talk to them, and not in a fight
     */
    nearStranger(id: number): boolean
    {
        const hero = this.shown.get(id)
        const { stranger } = this
        return !!hero && !!stranger && hero.hp > 0 && !this.playing && !this.inFight(id) &&
            Math.hypot(stranger.position.x - hero.meeple.position.x, stranger.position.z - hero.meeple.position.z) <= STRANGER_REACH
    }

    /**
     * The scene going on, null without one
     */
    get playingScene(): SceneStage | null
    {
        return this.playing?.stage ?? null
    }

    /**
     * Starts the scene of the stranger with a hero: the two step to their marks, facing each other, and the level stops
     */
    private startScene(id: number, hero: ShownHero): void
    {
        const stranger = this.stranger!
        const { meeple } = hero
        // nobody buys a map twice
        const script = traderScript(TRADER_WARES.filter(ware => ware !== "map" || !this.facts.has(CHARTED)))
        this.findMark(meeple.position, script.left)
        hero.face = spot.face
        meeple.position.set(spot.x, 0, spot.z)
        meeple.walking = false
        meeple.leftReady = false
        hero.steered = false
        hero.strikeAt = null
        meeple.facing = Math.atan2(stranger.position.x - spot.x, stranger.position.z - spot.z)
        stranger.facing = Math.atan2(spot.x - stranger.position.x, spot.z - stranger.position.z)
        this.onMoved(id, hero.face)

        const world: SceneWorld = {
            gold: () => this.outside.gold(id),
            pay: gold => this.outside.pay(id, gold),
            knows: concept => this.outside.knows(concept),
            learn: concept => this.outside.learn(concept),
            use: ware => this.use(id, hero, ware),
            fact: name => this.facts.has(name),
            setFact: name => this.addFact(name)
        }
        const stage = new SceneStage(new ScenePlayer(script, world), () => this.sceneChanged())
        this.playing = { stage, left: script.left, heroId: id, hero, other: stranger, otherFacing: stranger.facing }
        this.controls.enabled = false
        // for the first bubble to be in the right place
        this.placeSceneCamera(meeple.position, stranger.position, script.left, stage.shot)
        this.onScene()
    }

    /**
     * Finds the mark of the hero in the scene with the stranger, at the talking distance from them, as close to the way
     * the hero came from as it can be with all shots seeing both from inside the room, and puts it into spot
     */
    private findMark(from: Vector3, left: ActorRole): void
    {
        const { position } = this.stranger!
        const start = Math.atan2(from.x - position.x, from.z - position.z) || 0
        const mark = new Vector3()
        let fallback: FloorSpot | null = null
        for (let i = 0; i < MARK_TRIES; i++)
        {
            // 0, 1, -1, 2, -2, ...
            const step = (i + 1 >> 1) * (i % 2 ? 1 : -1)
            const angle = start + step * TAU / MARK_TRIES
            spot.face = this.strangerSpot!.face
            spot.x = position.x
            spot.z = position.z
            moveOnFloor(this.meshes!.world, this.solidWalls!, spot, Math.sin(angle) * TALK_DISTANCE, Math.cos(angle) * TALK_DISTANCE)
            if (Math.hypot(spot.x - position.x, spot.z - position.z) < TALK_DISTANCE * 0.9)
            {
                continue
            }
            fallback ??= { ...spot }
            mark.set(spot.x, 0, spot.z)
            if (Object.values(SHOTS).every(shot => this.shotSees(mark, position, left, shot)))
            {
                return
            }
        }
        if (fallback)
        {
            Object.assign(spot, fallback)
        }
    }

    /**
     * Returns whether the camera of a shot sees both actors without a wall in the way, and places it
     */
    private shotSees(a: Vector3, b: Vector3, left: ActorRole, shot: Shot): boolean
    {
        const { camera, sceneTarget } = this
        const walls = this.floorWalls!
        placeShot(a, b, left, shot, camera.position, sceneTarget)
        const { x, z } = camera.position
        return seesAcross(walls, a.x, a.z, x, z) && seesAcross(walls, b.x, b.z, x, z)
    }

    /**
     * Places the camera for a shot, pulled in toward the actors as far as it takes for no wall to be in the way
     */
    private placeSceneCamera(a: Vector3, b: Vector3, left: ActorRole, shot: Shot): void
    {
        const pulled = Object.assign(this.pulledShot, shot)
        for (const pull of SHOT_PULLS)
        {
            pulled.back = shot.back * pull
            if (this.shotSees(a, b, left, pulled))
            {
                break
            }
        }
        this.camera.lookAt(this.sceneTarget)
    }

    /**
     * Sets what scenes found out or decided before, see Campaign.facts
     */
    setFacts(facts: readonly string[]): void
    {
        this.facts.clear()
        for (const fact of facts)
        {
            this.facts.add(fact)
        }
    }

    private addFact(fact: string): void
    {
        if (!this.facts.has(fact))
        {
            this.facts.add(fact)
            this.onFacts?.([...this.facts])
        }
    }

    private sceneChanged(): void
    {
        const { playing } = this
        if (playing?.stage.ended)
        {
            this.addFact(MET_STRANGER)
            playing.other.facing = playing.otherFacing
            this.playing = null
            this.controls.enabled = true
            this.unplaced = true
        }
        this.onScene()
    }

    /**
     * Returns where above the head of an actor of the scene a bubble goes on the screen, from 0 to 1 from the top left,
     * null without a scene
     */
    actorOnScreen(actor: ActorRole): [number, number] | null
    {
        const { playing } = this
        if (!playing)
        {
            return null
        }
        const meeple = actor === "a" ? playing.hero.meeple : playing.other
        // the camera might have moved since the last frame
        this.camera.updateMatrixWorld()
        hit.copy(meeple.position).setY(BUBBLE_HEIGHT).project(this.camera)
        return [(hit.x + 1) / 2, (1 - hit.y) / 2]
    }

    /**
     * The player goes on after something said or shown in the scene
     */
    sceneNext(): void
    {
        this.playing?.stage.next()
    }

    /**
     * The player picks an option of the choice in the scene
     */
    sceneChoose(index: number): void
    {
        this.playing?.stage.choose(index)
    }

    /**
     * Has a hero drink or use what they bought
     */
    private use(id: number, hero: ShownHero, ware: Ware): void
    {
        if (ware === "healing")
        {
            hero.hp = hero.maxHp
            this.onHurt(id, hero.hp)
        }
        else if (ware === "speed")
        {
            hero.speedLeft = POTION_TIME
        }
        else if (ware === "strength")
        {
            hero.strengthLeft = POTION_TIME
        }
        else if (ware === "map")
        {
            this.addFact(CHARTED)
        }
    }

    /**
     * Moves the actors of the scene and the camera, while the rest of the level stands still
     */
    private updateScene(time: number, delta: number): void
    {
        const { stage, left, hero, other, otherFacing } = this.playing!
        stage.update(delta)
        const { beat } = stage
        if (beat?.kind === "act" && beat.clip === "shakeHead")
        {
            const actor = beat.actor === "a" ? hero.meeple : other
            const t = Math.min(1, stage.beatTime / ACT_TIME)
            const base = actor === other ? otherFacing : actor.facing
            actor.facing = base + Math.sin(t * SHAKES * Math.PI * 2) * SHAKE_ANGLE * Math.sin(t * Math.PI)
        }
        // the scene might have ended with the update
        if (this.playing)
        {
            const { meshes } = this
            this.placeSceneCamera(hero.meeple.position, other.position, left, stage.shot)
            const space = meshes!.near.spaceOf.get(hero.face)
            updateWallCut(meshes!.cut, space ? [space] : [], delta)
            if (hero.lightOn)
            {
                moveHeroLight(meshes!.field, meshes!.segments, hero.meeple.position.x, hero.meeple.position.z)
                flickerHeroLight(meshes!.field, time, heroBurn(hero.lightBurnt))
            }
        }
        this.crowd?.update(this.camera, time)
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
        return !!hero && hero.hp > 0 && !!this.chestNear(hero)
    }

    /**
     * Returns the closed chest a hero can open, in reach and in the same room
     */
    private chestNear(hero: ShownHero): Chest | null
    {
        const { position } = hero.meeple
        const room = this.level?.rooms.find(faces => faces.includes(hero.face)) ?? []
        return this.chests?.closedNear(position.x, position.z, new Set(room)) ?? null
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
            const speed = WALK_SPEED * walkSpeedMultiplier(meeple) * (hero.speedLeft > 0 ? SPEED_POTION : 1) * delta
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
            hero.speedLeft = Math.max(0, hero.speedLeft - delta)
            hero.strengthLeft = Math.max(0, hero.strengthLeft - delta)
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
        const { stranger } = this
        return {
            world: meshes.world,
            slots: this.slots,
            floor: this.floorSet,
            exploration,
            chests: chests.chests.map(({ face, x, z, openedAt }) => ({ face, x, z, opened: openedAt !== null })),
            exits: this.exits,
            rooms: hero ? this.jumpTargets(hero) : [],
            hero: hero ? { x: hero.meeple.position.x, z: hero.meeple.position.z, facing: hero.meeple.facing } : null,
            charted: this.facts.has(CHARTED),
            revealed: this.revealed,
            stranger: stranger && (this.facts.has(MET_STRANGER) || this.revealed) ? { x: stranger.position.x, z: stranger.position.z } : null
        }
    }

    /**
     * Returns where in the rooms with visited floor the given hero can jump to, in every room once the map is revealed,
     * leaving out the room they are in
     */
    private jumpTargets(hero: ShownHero): LevelMapState["rooms"]
    {
        const at = hero.face
        // TEMP god mode: every room once the map is revealed
        return jumpTargets(this.meshes!.world, this.level!.rooms, this.revealed ? EVERYWHERE : this.exploration!, at)
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
                monsters.strike(prey.x, prey.z, prey.facing, SLASH_OUTER, SLASH_WIDTH, hero.strengthLeft > 0 ? STRONG_SWORD_DAMAGE : SWORD_DAMAGE)
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

        const { bursts } = this
        const deaths = monsters.packs.flatMap(pack => pack.deaths.splice(0))
        for (const death of deaths)
        {
            bursts.add(death)
        }
        // brutes keep their club a while
        this.bruteCrowd!.update(this.brutes!.members, deaths, bursts, delta)
        this.soldierCrowd!.update(this.soldiers!.members, delta)
        bursts.update(delta)
        this.burstCrowd!.update(bursts.particles)
    }

    /**
     * Has the heroes pick up the coins they come close to, each for themselves, and plays a sound when one gets to them
     */
    private updateTreasure(time: number): void
    {
        const { chests, treasure } = this
        if (!chests)
        {
            return
        }
        for (const [id, hero] of this.shown)
        {
            const { meeple: { position }, hp } = hero
            if (hp === 0)
            {
                continue
            }
            // counts at once, so a hero who leaves right away has it
            const taken = chests.collect(position.x, position.z, time, id)
            const coins = taken.filter(({ potion }) => !potion).length
            if (coins > 0)
            {
                this.onLoot(id, coins * COIN_VALUE)
            }
            // drunk at once like a bought one, which tells what it is
            for (const { potion } of taken)
            {
                if (potion)
                {
                    this.use(id, hero, potion)
                    this.outside.learn(potion)
                }
            }
        }
        // only the hero the view is with is close enough to be heard
        for (const { takenBy } of chests.arrive(time))
        {
            if (takenBy === this.focus)
            {
                this.pickUpSound.play(PICK_UP_RATES[Math.floor(Math.random() * PICK_UP_RATES.length)], PICK_UP_VOLUME)
            }
        }
        treasure!.update(time, id => this.shown.get(id)?.meeple.position)
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
                if (this.playing)
                {
                    this.updateScene(time, delta)
                }
                else
                {
                    this.updateHeroes(time, delta)
                    this.updateView(time, delta)
                }
                this.updateSound()
                flickerLights(meshes.field, level.lighting!.lights, time)
                updateLightField(this.renderer, meshes.field)
            }
            if (!this.playing)
            {
                this.controls.update()
            }
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
