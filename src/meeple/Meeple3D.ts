import {
    BackSide,
    BufferGeometry,
    CanvasTexture,
    Color,
    DataTexture,
    Float32BufferAttribute,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    type Mesh,
    Matrix4,
    MeshBasicMaterial,
    MeshToonMaterial,
    NearestFilter,
    Quaternion,
    RedFormat,
    ShaderMaterial,
    SRGBColorSpace,
    type Camera,
    type Raycaster,
    Vector2,
    Vector3
} from "three"
import { canEquip, type Character, checkClasses } from "./character"
import { actItem, advanceItem, itemAnimation, itemPose, type ItemPose, type ItemState, newItemState, stopActing } from "../items/itemAnimation"
import { ITEM_PIXELS, type ItemName, ITEMS, type ItemSprite, itemSprite } from "../items/itemSprite"
import { bodySurface, createBodyGeometry, createHeadGeometry, createShortHair, HEAD_RADIUS, HEAD_Y } from "./meepleParts"
import { type ModelName, template } from "../render/scene3d"
import { rng } from "../math/random"
import { meepleNameGenerator } from "./nameGenerator";

const TAU = Math.PI * 2

/**
 * Scale from meeple units (a meeple is about 1.15 units tall) to world units, where one face is one unit.
 */
export const MEEPLE_SCALE = 0.3

/**
 * How far below HEAD_Y the head of the shortest meeple sits, and how much higher the head of the tallest one is, in
 * meeple units
 */
const HEAD_DROP = 0.05
const HEAD_RAISE = 0.18

/**
 * Thickness of the inverted hull outlines in meeple units
 */
const OUTLINE = 0.022

/**
 * Distance in head radii an eye is drawn in front of its point on the head. Facing the camera, an eye must clear the
 * head and the curly hair lumps, which reach about 1.45 head radii from the center.
 */
const EYE_LIFT = 0.5

/**
 * Size of one eye sprite in head radii
 */
const EYE_SIZE =0.9

/**
 * Angles in radians from the face center to the side and down to the points the eyes are pinned to
 */
const EYE_SPREAD = 0.4
const EYE_DROP = 0.15

/**
 * Eye ellipses in the eye texture: centers of the left and right eye, inner radii of the white and width of the outline
 * ring around it, in texture pixels
 */
const EYE_X = [36, 92]
const EYE_Y = 32
const EYE_RX = 21
const EYE_RY = 23
const EYE_RING = 4
const EYE_OUTLINE = "#1a1a24"

/**
 * Minimum height of an eye on screen in CSS pixels for the meeple to blink. Smaller eyes are too coarse to show the
 * lids.
 */
const BLINK_MIN_PIXELS = 14

/**
 * Range of the duration of a blink in seconds, 10 to 15 frames at 60 fps. Closing the lids takes the first third.
 */
const BLINK_MIN = 10 / 60
const BLINK_MAX = 15 / 60
const BLINK_CLOSE = 1 / 3

/**
 * Range of the pause between two blinks in seconds
 */
const BLINK_PAUSE_MIN = 10
const BLINK_PAUSE_MAX = 30

/**
 * Factors on the pause between blinks for a gait of 0 and 1. The bouncy walkers blink more often.
 */
const WIDE_GAIT_BLINK = 1.2
const NARROW_GAIT_BLINK = 0.8

/**
 * Length of the longer side of an item sprite of ITEM_PIXELS in meeple units
 */
const ITEM_SIZE = 0.7

/**
 * Walk cycle speed in radians per second. Each cycle has two steps.
 */
const WALK_SPEED = 5.5

/**
 * Height of a step bounce in meeple units, and how much the body stretches with it
 */
const WALK_BOUNCE = 0.07
const WALK_STRETCH = 0.2

/**
 * Angle in radians the meeple rocks from side to side around its facing direction while walking, and the height of
 * the pivot, at about the belly button
 */
const WALK_ROLL = 0.12
const WALK_PIVOT = 0.3

/**
 * Factors on the rocking, the bounce, the speed and the item swing of the walk for a gait of 0, a wide waddle, and 1,
 * a narrow, bouncy step. The speed is fastest for a gait of 0.5 and slows toward both ends.
 */
const WIDE_GAIT = { roll: 1.6, bounce: 1, speed: 0.75, swing: 1 }
const NARROW_GAIT = { roll: 0.9, bounce: 1.9, speed: 0.85, swing: 0.35 }

/**
 * Speed of turning toward the camera and back, in full turns per second
 */
const ATTENTION_SPEED = 3

/**
 * Maximum angle in radians a meeple looking at the camera tilts its head up
 */
const MAX_LOOK_UP = 1.0

export enum HairStyle
{
    CURLY,
    SHORT,
    BALD,
    LONG,
    SIDE_PART
}

/**
 * Hair styles modeled in Blender, around the head center
 */
const HAIR_MODELS = new Map<HairStyle, ModelName>([
    [HairStyle.CURLY, "hairCurly"],
    [HairStyle.LONG, "hairLong"],
    [HairStyle.SIDE_PART, "hairSidePart"]
])

/**
 * Models to load with loadModels() before creating a MeepleCrowd
 */
export const MEEPLE_MODELS = [...HAIR_MODELS.values()]

export interface MeepleLook
{
    skin: Color
    shirt: Color
    hair: Color
    hairStyle: HairStyle
    /**
     * Height from 0 to 1
     */
    height: number
}

export interface Meeple
{
    position: Vector3
    /**
     * Rotation around the y axis, 0 faces +z
     */
    facing: number
    look: MeepleLook
    /**
     * Phase offset of the walk animation
     */
    phase: number
    name: string
    /**
     * Walking style from 0 to 1. 0 rocks wider from side to side, 1 is narrower with a higher bounce.
     */
    gait: number
    /**
     * Turns the meeple toward the camera with its face up to the viewer, e.g. while the player interacts with it
     */
    lookAtCamera?: boolean
    /**
     * Item held in the right hand. Like the look, it must not change after the meeple was added.
     */
    item?: ItemName
    /**
     * Item held in the left hand, animated like in the right one, but mirrored. It must not change either.
     */
    leftItem?: ItemName
    /**
     * Stats and classes. With them, the meeple must meet the minimum stats of its classes and be allowed to hold its
     * items.
     */
    character?: Character
    /**
     * Holds the items readied. Acting readies them as well.
     */
    ready?: boolean
}


/**
 * Random traits of a new meeple besides its look
 */
export function randomTraits(): Pick<Meeple, "name" | "gait">
{
    return {
        name: meepleNameGenerator(4),
        gait: rng.next()
    }
}


function createGradientMap(): DataTexture
{
    // three hard shading steps like the shadow and body tone of the 2D sprites
    const tex = new DataTexture(new Uint8Array([90, 180, 255]), 3, 1, RedFormat)
    tex.minFilter = tex.magFilter = NearestFilter
    tex.needsUpdate = true
    return tex
}


function createEyeTexture(): CanvasTexture
{
    const canvas = document.createElement("canvas")
    canvas.width = 128
    canvas.height = 64
    const ctx = canvas.getContext("2d")!

    for (const x of EYE_X)
    {
        ctx.fillStyle = EYE_OUTLINE
        ctx.beginPath()
        ctx.ellipse(x, EYE_Y, EYE_RX + EYE_RING, EYE_RY + EYE_RING, 0, 0, TAU)
        ctx.fill()

        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.ellipse(x, EYE_Y, EYE_RX, EYE_RY, 0, 0, TAU)
        ctx.fill()

        ctx.fillStyle = "#4a6fb0"
        ctx.beginPath()
        ctx.arc(x, 36, 13, 0, TAU)
        ctx.fill()

        ctx.fillStyle = "#101018"
        ctx.beginPath()
        ctx.arc(x, 37, 8, 0, TAU)
        ctx.fill()

        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.arc(x - 5, 30, 4, 0, TAU)
        ctx.fill()
    }

    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    return tex
}


/**
 * Two camera facing quads, one per eye, each pinned to its own point on the head. An eye keeps its size and slides
 * behind the head as its point turns away from the camera.
 */
function createEyeGeometry(): BufferGeometry
{
    const positions: number[] = []
    const uvs: number[] = []
    const sides: number[] = []
    const indices: number[] = []

    // the meeple's +x is on the left of the texture when it faces the camera
    for (const side of [-1, 1])
    {
        const base = positions.length / 3
        const u0 = side < 0 ? 0 : 0.5
        for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]])
        {
            positions.push(x, y, 0)
            uvs.push(u0 + (x + 0.5) * 0.5, y + 0.5)
            sides.push(side)
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    geometry.setAttribute("side", new Float32BufferAttribute(sides, 1))
    geometry.setIndex(indices)
    return geometry
}


function createEyeMaterial(): ShaderMaterial
{
    return new ShaderMaterial({
        uniforms: {
            map: { value: createEyeTexture() },
            headRadius: { value: HEAD_RADIUS },
            eyeSize: { value: HEAD_RADIUS * EYE_SIZE },
            outline: { value: new Color(EYE_OUTLINE) },
            // height of the drawing area in CSS pixels
            viewportHeight: { value: 1 }
        },
        vertexShader: /* glsl */`
            attribute float side;
            attribute float blink;
            uniform float headRadius;
            uniform float eyeSize;
            uniform float viewportHeight;
            varying vec2 vUv;
            varying vec3 vSkin;
            varying float vBlink;

            #define EYE_LIFT ${EYE_LIFT.toFixed(2)}
            #define EYE_SPREAD ${EYE_SPREAD.toFixed(2)}
            #define EYE_DROP ${EYE_DROP.toFixed(2)}

            void main()
            {
                vUv = uv;
                mat4 mv = modelViewMatrix * instanceMatrix;
                float scale = length((mv * vec4(1.0, 0.0, 0.0, 0.0)).xyz);

                // the point on the head the eye is pinned to, slightly below and to the side of the face center
                vec3 dir = vec3(
                    side * sin(EYE_SPREAD) * cos(EYE_DROP),
                    -sin(EYE_DROP),
                    cos(EYE_SPREAD) * cos(EYE_DROP)
                );
                vec3 anchor = (mv * vec4(dir * headRadius, 1.0)).xyz;

                vec3 pos = anchor;
                pos.xy += position.xy * eyeSize * scale;

                // slide every vertex along its view ray onto a plane a little in front of the eye's point on the
                // head. The eyes keep their place on screen, and the nearer eye is drawn over the farther one.
                // Facing the camera, the plane clears the head and hair, so an eye is drawn whole. As the point turns
                // away, the plane sinks into the head, which then hides the eye from the face side, like sliding
                // behind it. Other meeples are far enough away to still hide them correctly.
                float depth = anchor.z + headRadius * scale * EYE_LIFT;
                pos *= depth / pos.z;

                gl_Position = projectionMatrix * vec4(pos, 1.0);

                // only eyes large enough on screen blink
                float pixels = eyeSize * scale * projectionMatrix[1][1] / -depth * viewportHeight * 0.5;
                vBlink = pixels < ${BLINK_MIN_PIXELS.toFixed(1)} ? 0.0 : blink;
                vSkin = instanceColor;
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D map;
            uniform vec3 outline;
            varying vec2 vUv;
            varying vec3 vSkin;
            varying float vBlink;

            #define PI 3.14159265

            void main()
            {
                vec4 color = texture2D(map, vUv);
                if (color.a < 0.5) discard;
                gl_FragColor = vec4(color.rgb, 1.0);

                if (vBlink > 0.0)
                {
                    // position in the white of the eye, from -1 to 1 on both axes, y up
                    vec2 px = vec2(vUv.x * 128.0, (1.0 - vUv.y) * 64.0);
                    float cx = vUv.x < 0.5 ? ${EYE_X[0].toFixed(1)} : ${EYE_X[1].toFixed(1)};
                    vec2 q = vec2((px.x - cx) / ${EYE_RX.toFixed(1)}, (${EYE_Y.toFixed(1)} - px.y) / ${EYE_RY.toFixed(1)});

                    // the lid turns down over the eyeball like a shell around the axis through its side corners. Its
                    // edge is a great circle of the ball, which arches up while the lid is open less than halfway and
                    // sags down after it.
                    float rim = sqrt(max(0.001, 1.0 - q.x * q.x));
                    float edge = rim * cos(vBlink * PI);
                    // distance in pixels to the edge, across its slope, so the line keeps its width toward the corners
                    float slope = -q.x / rim * cos(vBlink * PI) * ${(EYE_RY / EYE_RX).toFixed(3)};
                    float dist = (q.y - edge) * ${EYE_RY.toFixed(1)} / sqrt(1.0 + slope * slope);
                    if (dot(q, q) < 1.0 && dist > -${EYE_RING.toFixed(1)})
                    {
                        // skin above the edge, outlined like the eye
                        gl_FragColor.rgb = q.y > edge ? vSkin : outline;
                    }
                }
                #include <colorspace_fragment>
            }
        `
    })
}


/**
 * Returns the geometry of a loaded hair model. The objects have their origin at the head center, so the geometry is
 * used as it is and their transforms are ignored.
 */
function hairGeometry(name: ModelName): BufferGeometry
{
    let geometry: BufferGeometry | null = null
    template(name).traverse(obj => {
        const mesh = obj as Mesh
        if (mesh.isMesh && !geometry)
        {
            geometry = mesh.geometry
        }
    })
    if (!geometry)
    {
        throw new Error("No mesh in hair model " + name)
    }
    return geometry
}


function createItemPart(sprite: ItemSprite, gradientMap: DataTexture, capacity: number): InstancedMesh
{
    // the outline is part of the sprite, so the item needs no hull
    const mesh = new InstancedMesh(sprite.geometry, new MeshToonMaterial({ map: sprite.texture, alphaTest: 0.5, gradientMap }), capacity)
    mesh.castShadow = true
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
}


function createOutlineMaterial(color: Color): MeshBasicMaterial
{
    const material = new MeshBasicMaterial({ color, side: BackSide })
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>\ntransformed += normal * ${OUTLINE.toFixed(4)};`
        )
    }
    return material
}

function blinkPause(gait: number): number
{
    const factor = WIDE_GAIT_BLINK + (NARROW_GAIT_BLINK - WIDE_GAIT_BLINK) * gait
    return (BLINK_PAUSE_MIN + rng.next() * (BLINK_PAUSE_MAX - BLINK_PAUSE_MIN)) * factor
}

function blinkDuration(): number
{
    return BLINK_MIN + rng.next() * (BLINK_MAX - BLINK_MIN)
}

export function walkSpeedMultiplier(meeple: Meeple) : number
{
    const { gait } = meeple
    const extreme = gait < 0.5 ? WIDE_GAIT : NARROW_GAIT
    return (1 + (extreme.speed - 1) * Math.abs(gait * 2 - 1))
}


/**
 * Instanced 3D meeples built from a few shared parts, like the 2D version. Each part type is one draw call (plus one
 * for its outline), so the number of meeples hardly matters. The MEEPLE_MODELS must be loaded first.
 */
export default class MeepleCrowd
{
    readonly group = new Group()
    readonly meeples: Meeple[] = []

    /**
     * Angle in radians the whole figure leans back, away from the camera, to show more face from above
     */
    lean = 0
    /**
     * Extra angle in radians the head tilts up, negative to tilt it down toward the feet
     */
    headTilt = 0.29
    walking = false

    /**
     * How far each meeple has turned toward the camera, from 0 to 1
     */
    private readonly attention: number[] = []
    /**
     * Animation states of the right and the left hand
     */
    private readonly itemStates: [ItemState, ItemState][] = []
    private lastTime = 0

    private readonly capacity: number
    private readonly body: InstancedMesh
    private readonly head: InstancedMesh
    private readonly eyes: InstancedMesh
    /**
     * How far each meeple's lids are closed, from 0 to 1
     */
    private readonly blink: InstancedBufferAttribute
    /**
     * Time in seconds each meeple starts its next blink
     */
    private readonly nextBlink: number[] = []
    /**
     * Duration in seconds of each meeple's next blink
     */
    private readonly blinkDuration: number[] = []
    private readonly hair: Map<HairStyle, InstancedMesh>
    /**
     * Instanced item per loaded item sprite
     */
    private readonly items: Map<ItemName, InstancedMesh>
    /**
     * Length of the longer side of each item in meeple units
     */
    private readonly itemSizes = new Map<ItemName, number>()
    private readonly outlines: InstancedMesh[] = []

    constructor(capacity: number)
    {
        this.capacity = capacity

        const gradientMap = createGradientMap()
        const toon = new MeshToonMaterial({ gradientMap })

        this.body = this.createPart(createBodyGeometry(), toon, true)
        this.head = this.createPart(createHeadGeometry(), toon, true)
        // short hair lies on the head faces, so it wins the depth test with an offset and needs no outline of its own
        const shortHair = toon.clone()
        shortHair.polygonOffset = true
        shortHair.polygonOffsetFactor = shortHair.polygonOffsetUnits = -1
        this.hair = new Map([
            ...[...HAIR_MODELS].map(([style, name]) => [style, this.createPart(hairGeometry(name), toon, true)] as const),
            [HairStyle.SHORT, this.createPart(createShortHair(), shortHair, false)]
        ])

        const eyeGeometry = createEyeGeometry()
        this.blink = new InstancedBufferAttribute(new Float32Array(capacity), 1)
        eyeGeometry.setAttribute("blink", this.blink)
        const eyeMaterial = createEyeMaterial()
        this.eyes = new InstancedMesh(eyeGeometry, eyeMaterial, capacity)
        this.eyes.frustumCulled = false
        // the skin color of the lids
        this.eyes.setColorAt(0, new Color())
        this.eyes.onBeforeRender = renderer => eyeMaterial.uniforms.viewportHeight.value = renderer.getSize(tmpSize).y
        this.group.add(this.eyes)

        this.items = new Map()
        for (const name of ITEMS)
        {
            const sprite = itemSprite(name)
            if (sprite)
            {
                // one per hand
                const mesh = createItemPart(sprite, gradientMap, capacity * 2)
                this.items.set(name, mesh)
                this.itemSizes.set(name, ITEM_SIZE * sprite.pixels / ITEM_PIXELS * sprite.scale)
                this.group.add(mesh)
            }
        }

        for (const mesh of [this.body, this.head, this.eyes, ...this.hair.values()])
        {
            mesh.count = 0
        }
    }

    get outlinesVisible(): boolean
    {
        return this.outlines[0].visible
    }

    set outlinesVisible(visible: boolean)
    {
        this.outlines.forEach(o => o.visible = visible)
    }

    private createPart(geometry: BufferGeometry, material: MeshToonMaterial, outline: boolean): InstancedMesh
    {
        const mesh = new InstancedMesh(geometry, material, this.capacity)
        mesh.castShadow = true
        mesh.frustumCulled = false
        // allocate the instance colors
        mesh.setColorAt(0, new Color())
        this.group.add(mesh)

        if (outline)
        {
            const hull = new InstancedMesh(geometry, createOutlineMaterial(new Color("#1a1420")), this.capacity)
            // share the matrices, so the hull always follows its part
            hull.instanceMatrix = mesh.instanceMatrix
            hull.frustumCulled = false
            hull.onBeforeRender = () => hull.count = mesh.count
            this.group.add(hull)
            this.outlines.push(hull)
        }
        return mesh
    }

    add(meeple: Meeple): void
    {
        if (this.meeples.length >= this.capacity)
        {
            throw new Error("Meeple capacity exceeded")
        }
        if (meeple.character)
        {
            const problem = checkClasses(meeple.character) ?? canEquip(meeple.character, meeple.item, meeple.leftItem)
            if (problem)
            {
                throw new Error(meeple.name + ": " + problem)
            }
        }
        for (const item of [meeple.item, meeple.leftItem])
        {
            if (item)
            {
                // the held item and the images its animation draws instead
                const { idle, ready, action } = itemAnimation(item)
                for (const name of [item, ...[idle, ready, ...action.steps].map(p => p.image)])
                {
                    if (name && !this.items.has(name))
                    {
                        throw new Error("Item not loaded: " + name)
                    }
                }
            }
        }
        const i = this.meeples.length
        this.meeples.push(meeple)
        this.attention.push(0)
        this.itemStates.push([newItemState(), newItemState()])
        // start somewhere into the first pause, so the crowd doesn't wait and then all start blinking together
        this.nextBlink.push(this.lastTime + rng.next() * blinkPause(meeple.gait))
        this.blinkDuration.push(blinkDuration())

        // only the new meeple's colors, rewriting all of them on every add makes building a crowd quadratic
        const { look } = meeple
        this.body.setColorAt(i, look.shirt)
        this.head.setColorAt(i, look.skin)
        this.eyes.setColorAt(i, look.skin)
        this.body.count = this.head.count = this.eyes.count = i + 1
        this.body.instanceColor!.needsUpdate = true
        this.head.instanceColor!.needsUpdate = true
        this.eyes.instanceColor!.needsUpdate = true

        // hair instances are packed per style in the order the meeples were added
        const hair = this.hair.get(look.hairStyle)
        if (hair)
        {
            // short hair lets some skin show through
            const color = look.hairStyle === HairStyle.SHORT ? tmpColor.copy(look.hair).lerp(look.skin, 1 / 3) : look.hair
            hair.setColorAt(hair.count++, color)
            hair.instanceColor!.needsUpdate = true
        }
    }

    /**
     * Readies the meeple's items and uses them, again and again if an item's action repeats, until stopActing()
     */
    act(meeple: Meeple): void
    {
        const states = this.itemStates[this.meeples.indexOf(meeple)]
        const items = [meeple.item, meeple.leftItem]
        items.forEach((item, hand) => item && actItem(itemAnimation(item), states[hand]))
    }

    /**
     * Stops using the meeple's items after their current actions
     */
    stopActing(meeple: Meeple): void
    {
        this.itemStates[this.meeples.indexOf(meeple)].forEach(stopActing)
    }

    /**
     * Returns the meeple whose body or head the ray hits first
     */
    pick(raycaster: Raycaster): Meeple | null
    {
        for (const mesh of [this.body, this.head])
        {
            // the matrices change every frame
            mesh.computeBoundingSphere()
        }
        // body and head instances have the index of their meeple
        const [hit] = raycaster.intersectObjects([this.body, this.head], false)
        return hit?.instanceId !== undefined ? this.meeples[hit.instanceId] : null
    }

    /**
     * Updates all instance matrices for the current camera and animation time in seconds
     */
    update(camera: Camera, time: number): void
    {
        const counts = new Map<HairStyle, number>()
        const itemCounts = new Map<ItemName, number>()
        const step = Math.min(0.1, Math.max(0, time - this.lastTime)) * ATTENTION_SPEED
        this.lastTime = time
        const cam = camera.position

        this.meeples.forEach((meeple, i) => {
            const { position, look, phase, gait } = meeple

            let bounce = 0, stretch = 1, roll = 0, swing = 0
            if (this.walking)
            {
                // the body is highest and rocked furthest over the foot it stands on
                const speed = WALK_SPEED * walkSpeedMultiplier(meeple)
                const s = Math.sin(time * speed + phase)
                const bounceFactor = WIDE_GAIT.bounce + (NARROW_GAIT.bounce - WIDE_GAIT.bounce) * gait
                bounce = Math.abs(s) * WALK_BOUNCE * bounceFactor
                stretch = 1 + s * WALK_STRETCH * (0.1 + gait * 0.9)
                roll = s * WALK_ROLL * (WIDE_GAIT.roll + (NARROW_GAIT.roll - WIDE_GAIT.roll) * gait)
                // the item's pose sets how far it swings
                swing = s * (WIDE_GAIT.swing + (NARROW_GAIT.swing - WIDE_GAIT.swing) * gait)
            }

            const headY = (HEAD_Y - HEAD_DROP + look.height * HEAD_RAISE) * (stretch * 0.5 + 0.5)

            // ease toward the camera and back
            const target = meeple.lookAtCamera ? 1 : 0
            const attention = this.attention[i] += Math.max(-step, Math.min(step, target - this.attention[i]))
            const t = attention * attention * (3 - 2 * attention)

            let facing = meeple.facing
            let headTilt = this.headTilt
            if (t > 0)
            {
                const dx = cam.x - position.x
                const dz = cam.z - position.z
                // shortest turn toward the camera
                const turn = ((Math.atan2(dx, dz) - facing) % TAU + TAU * 1.5) % TAU - Math.PI
                facing += turn * t

                const lookUp = Math.atan2(cam.y - position.y - headY * MEEPLE_SCALE, Math.hypot(dx, dz))
                headTilt += (Math.min(MAX_LOOK_UP, lookUp) - this.lean - headTilt) * t
            }

            // lean back, away from the camera, around the feet
            toCamera.set(cam.x - position.x, 0, cam.z - position.z).normalize()
            axis.crossVectors(UP, toCamera)
            leanRotation.setFromAxisAngle(axis, -this.lean)
            facingRotation.setFromAxisAngle(UP, facing)
            rotation.multiplyQuaternions(leanRotation, facingRotation)

            figure.compose(tmpPos.set(position.x, position.y + bounce * MEEPLE_SCALE, position.z), rotation, tmpScale.setScalar(MEEPLE_SCALE))
            if (roll !== 0)
            {
                // rock around the facing direction at belly height
                local.makeTranslation(0, WALK_PIVOT, 0)
                    .multiply(rollMatrix.makeRotationZ(roll))
                    .multiply(rollPivot.makeTranslation(0, -WALK_PIVOT, 0))
                figure.multiply(local)
            }

            const squeeze = 1 / Math.sqrt(stretch)
            local.makeScale(squeeze, stretch, squeeze)
            this.body.setMatrixAt(i, part.multiplyMatrices(figure, local))

            local.makeRotationX(-headTilt).setPosition(0, headY, 0)
            part.multiplyMatrices(figure, local)
            this.head.setMatrixAt(i, part)
            this.eyes.setMatrixAt(i, part)

            this.blink.setX(i, this.blinkAt(i, time))

            const hair = this.hair.get(look.hairStyle)
            if (hair)
            {
                const n = counts.get(look.hairStyle) ?? 0
                hair.setMatrixAt(n, part)
                counts.set(look.hairStyle, n + 1)
            }

            const items = [meeple.item, meeple.leftItem]
            items.forEach((item, hand) => {
                if (!item)
                {
                    return
                }
                const animation = itemAnimation(item)
                const state = this.itemStates[i][hand]
                advanceItem(animation, state, !!meeple.ready, time)
                const { pivot, height, angle, lift } = itemPose(animation, state, time, pose)
                // the drawn image can change with the pose
                const image = pose.image ?? item
                const size = this.itemSizes.get(image)!

                // the attachment point moves with the stretch of the body, its normal by the inverse scale
                bodySurface(height, angle, attach, normal)
                normal.set(normal.x / squeeze, normal.y / stretch, normal.z / squeeze).normalize()
                attach.set(attach.x * squeeze, attach.y * stretch, attach.z * squeeze)
                    .addScaledVector(normal, lift)

                // lay the sprite onto the surface, its x axis horizontal, and turn it around the attachment point,
                // swinging with the steps. The hands swing in turn.
                tangent.crossVectors(UP, normal).normalize()
                bitangent.crossVectors(normal, tangent)
                local.makeBasis(tangent, bitangent, normal)
                    .multiply(rollMatrix.makeRotationZ(pose.roll + (hand ? -swing : swing) * pose.swing))
                    .setPosition(attach)
                    // scale the sprite and move its pivot to the attachment point
                    .multiply(itemShape.makeTranslation(-pivot[0] * size, -pivot[1] * size, 0).scale(itemScale.setScalar(size)))
                if (hand)
                {
                    // mirror onto the left side, which mirrors the image as well. Flipping the sprite through its
                    // thickness keeps its look and turns the faces outward again.
                    local.premultiply(MIRROR_X).multiply(MIRROR_Z)
                }

                // the instances are packed per image anew every frame
                const n = itemCounts.get(image) ?? 0
                this.items.get(image)!.setMatrixAt(n, part.multiplyMatrices(figure, local))
                itemCounts.set(image, n + 1)
            })
        })

        for (const [name, mesh] of this.items)
        {
            mesh.count = itemCounts.get(name) ?? 0
        }

        for (const mesh of [this.body, this.head, this.eyes, ...this.hair.values(), ...this.items.values()])
        {
            mesh.instanceMatrix.needsUpdate = true
        }
        this.blink.needsUpdate = true
    }

    /**
     * Returns how far the lids of meeple i are closed at the given time, starting its next blink when one is over
     */
    private blinkAt(i: number, time: number): number
    {
        // progress through the blink from 0 to 1
        let t = (time - this.nextBlink[i]) / this.blinkDuration[i]
        if (t >= 1 || time < this.nextBlink[i] - BLINK_PAUSE_MAX * WIDE_GAIT_BLINK)
        {
            // over, or the clock jumped back
            this.nextBlink[i] = time + blinkPause(this.meeples[i].gait)
            this.blinkDuration[i] = blinkDuration()
            return 0
        }
        if (t < 0)
        {
            return 0
        }
        if (t < BLINK_CLOSE)
        {
            // ease in
            t /= BLINK_CLOSE
            return t * t
        }
        // ease out
        t = (1 - t) / (1 - BLINK_CLOSE)
        return t * t
    }
}

const UP = new Vector3(0, 1, 0)
const toCamera = new Vector3()
const axis = new Vector3()
const leanRotation = new Quaternion()
const facingRotation = new Quaternion()
const rotation = new Quaternion()
const figure = new Matrix4()
const local = new Matrix4()
const part = new Matrix4()
const rollMatrix = new Matrix4()
const rollPivot = new Matrix4()
const tmpPos = new Vector3()
const tmpScale = new Vector3()
const tmpColor = new Color()
const tmpSize = new Vector2()
const attach = new Vector3()
const normal = new Vector3()
const tangent = new Vector3()
const bitangent = new Vector3()
const pose: ItemPose = { pivot: [0, 0], height: 0, angle: 0, lift: 0, roll: 0, swing: 0 }
const itemShape = new Matrix4()
const MIRROR_X = new Matrix4().makeScale(-1, 1, 1)
const MIRROR_Z = new Matrix4().makeScale(1, 1, -1)
const itemScale = new Vector3()
