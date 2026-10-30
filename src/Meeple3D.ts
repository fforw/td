import {
    BackSide,
    BufferGeometry,
    CanvasTexture,
    Color,
    DataTexture,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    MeshToonMaterial,
    NearestFilter,
    PlaneGeometry,
    Quaternion,
    RedFormat,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    type Camera,
    Vector3
} from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

const TAU = Math.PI * 2

/**
 * Scale from meeple units (a meeple is about 1.15 units tall) to world units, where one face is one unit.
 */
export const MEEPLE_SCALE = 0.3

const BODY_RADIUS = 0.27
const BODY_STRETCH = 1.15
const HEAD_RADIUS = 0.3

/**
 * Head center height for a meeple of height 0. Like in 2D, the height only moves the head up.
 */
const HEAD_Y = 0.78
const HEAD_RAISE = 0.1

/**
 * Thickness of the inverted hull outlines in meeple units
 */
const OUTLINE = 0.022

export enum HairStyle
{
    CURLY,
    SHORT,
    BALD
}

const HAIR_STYLES = [HairStyle.CURLY, HairStyle.SHORT]

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
}


function createGradientMap(): DataTexture
{
    // three hard shading steps like the shadow and body tone of the 2D sprites
    const tex = new DataTexture(new Uint8Array([110, 190, 255]), 3, 1, RedFormat)
    tex.minFilter = tex.magFilter = NearestFilter
    tex.needsUpdate = true
    return tex
}


function createCurlyHair(): BufferGeometry
{
    // overlapping lumps over the top and back of the head, leaving the face free
    const lumps: BufferGeometry[] = []
    const r = HEAD_RADIUS * 1.02
    for (let ring = 0; ring < 3; ring++)
    {
        const elevation = 0.35 + ring * 0.42
        const count = [9, 7, 3][ring]
        for (let i = 0; i < count; i++)
        {
            const azimuth = (i + ring * 0.5) / count * TAU
            const front = Math.cos(azimuth)
            // skip the forehead in the lowest ring
            if (ring === 0 && front > 0.3)
            {
                continue
            }
            const lump = new SphereGeometry(HEAD_RADIUS * (ring === 2 ? 0.42 : 0.36), 7, 5)
            const ce = Math.cos(elevation)
            lump.translate(
                Math.sin(azimuth) * ce * r,
                Math.sin(elevation) * r,
                front * ce * r
            )
            lumps.push(lump)
        }
    }
    const geometry = mergeGeometries(lumps)
    lumps.forEach(l => l.dispose())
    return geometry
}


function createShortHair(): BufferGeometry
{
    // a cap tilted back so it covers the back of the head but leaves the forehead visible
    const geometry = new SphereGeometry(HEAD_RADIUS * 1.08, 12, 6, 0, TAU, 0, Math.PI * 0.42)
    geometry.rotateX(-0.45)
    return geometry
}


function createEyeTexture(): CanvasTexture
{
    const canvas = document.createElement("canvas")
    canvas.width = 128
    canvas.height = 64
    const ctx = canvas.getContext("2d")!

    for (const x of [36, 92])
    {
        ctx.fillStyle = "#1a1a24"
        ctx.beginPath()
        ctx.ellipse(x, 32, 25, 27, 0, 0, TAU)
        ctx.fill()

        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.ellipse(x, 32, 21, 23, 0, 0, TAU)
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
 * Camera facing quad placed on the front of the head. It squashes and slides sideways when the meeple turns, and
 * disappears when it faces away.
 */
function createEyeMaterial(): ShaderMaterial
{
    return new ShaderMaterial({
        uniforms: {
            map: { value: createEyeTexture() },
            headRadius: { value: HEAD_RADIUS },
            eyeWidth: { value: HEAD_RADIUS * 1.45 }
        },
        vertexShader: /* glsl */`
            uniform float headRadius;
            uniform float eyeWidth;
            varying vec2 vUv;

            void main()
            {
                vUv = uv;
                mat4 mv = modelViewMatrix * instanceMatrix;
                vec3 center = (mv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                vec3 forward = (mv * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
                vec3 up = (mv * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
                float scale = length(forward);

                // how much the face points at the camera, which looks down -z in view space
                float front = forward.z / scale;
                if (front < 0.4)
                {
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                    return;
                }

                // the eyes sit low on the face, then pull them toward the camera so they don't clip into the head.
                // In profile they stay further in and get narrower, so they never stick out of the silhouette.
                vec3 pos = center + forward * 0.6 * headRadius - up * 0.12 * headRadius;
                pos.z += headRadius * scale * 0.35;
                pos.xy += position.xy * eyeWidth * scale * vec2(mix(0.3, 1.0, front), 1.0);

                gl_Position = projectionMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D map;
            varying vec2 vUv;

            void main()
            {
                vec4 color = texture2D(map, vUv);
                if (color.a < 0.5) discard;
                gl_FragColor = vec4(color.rgb, 1.0);
                #include <colorspace_fragment>
            }
        `
    })
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


/**
 * Instanced 3D meeples built from a few shared parts, like the 2D version. Each part type is one draw call (plus one
 * for its outline), so the number of meeples hardly matters.
 */
export default class MeepleCrowd
{
    readonly group = new Group()
    readonly meeples: Meeple[] = []

    /**
     * Angle in radians the whole figure leans back, away from the camera, to show more face from above
     */
    lean = 0.3
    /**
     * Extra angle in radians the head tilts up
     */
    headTilt = 0.2
    walking = false

    private readonly capacity: number
    private readonly body: InstancedMesh
    private readonly head: InstancedMesh
    private readonly eyes: InstancedMesh
    private readonly hair: Map<HairStyle, InstancedMesh>
    private readonly outlines: InstancedMesh[] = []

    constructor(capacity: number)
    {
        this.capacity = capacity

        const gradientMap = createGradientMap()
        const toon = new MeshToonMaterial({ gradientMap })

        const bodyGeometry = new SphereGeometry(BODY_RADIUS, 12, 8)
        // flat bottom so the egg stands on the ground
        bodyGeometry.scale(1, BODY_STRETCH, 1)
        bodyGeometry.translate(0, BODY_RADIUS * BODY_STRETCH, 0)

        this.body = this.createPart(bodyGeometry, toon, true)
        this.head = this.createPart(new SphereGeometry(HEAD_RADIUS, 14, 10), toon, true)
        this.hair = new Map(HAIR_STYLES.map(style => [
            style,
            this.createPart(style === HairStyle.CURLY ? createCurlyHair() : createShortHair(), toon, true)
        ]))

        this.eyes = new InstancedMesh(new PlaneGeometry(1, 0.5), createEyeMaterial(), capacity)
        this.eyes.frustumCulled = false
        this.group.add(this.eyes)

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
        this.meeples.push(meeple)
        this.updateColors()
    }

    private updateColors(): void
    {
        const counts = new Map<HairStyle, number>()
        this.meeples.forEach((m, i) => {
            const { look } = m
            this.body.setColorAt(i, look.shirt)
            this.head.setColorAt(i, look.skin)
            const hair = this.hair.get(look.hairStyle)
            if (hair)
            {
                const n = counts.get(look.hairStyle) ?? 0
                hair.setColorAt(n, look.hair)
                counts.set(look.hairStyle, n + 1)
            }
        })

        const n = this.meeples.length
        this.body.count = this.head.count = this.eyes.count = n
        for (const [style, mesh] of this.hair)
        {
            mesh.count = counts.get(style) ?? 0
            mesh.instanceColor!.needsUpdate = true
        }
        this.body.instanceColor!.needsUpdate = true
        this.head.instanceColor!.needsUpdate = true
    }

    /**
     * Updates all instance matrices for the current camera and animation time in seconds
     */
    update(camera: Camera, time: number): void
    {
        const counts = new Map<HairStyle, number>()

        this.meeples.forEach((meeple, i) => {
            const { position, facing, look, phase } = meeple

            let bounce = 0, stretch = 1
            if (this.walking)
            {
                const s = Math.sin(time * 9 + phase)
                bounce = Math.abs(s) * 0.07
                stretch = 1 + s * 0.05
            }

            // lean back, away from the camera, around the feet
            toCamera.set(camera.position.x - position.x, 0, camera.position.z - position.z).normalize()
            axis.crossVectors(UP, toCamera)
            leanRotation.setFromAxisAngle(axis, -this.lean)
            facingRotation.setFromAxisAngle(UP, facing)
            rotation.multiplyQuaternions(leanRotation, facingRotation)

            figure.compose(tmpPos.set(position.x, position.y + bounce * MEEPLE_SCALE, position.z), rotation, tmpScale.setScalar(MEEPLE_SCALE))

            local.makeScale(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch))
            this.body.setMatrixAt(i, part.multiplyMatrices(figure, local))

            const headY = (HEAD_Y + look.height * HEAD_RAISE) * (stretch * 0.5 + 0.5)
            local.makeRotationX(-this.headTilt).setPosition(0, headY, 0)
            part.multiplyMatrices(figure, local)
            this.head.setMatrixAt(i, part)
            this.eyes.setMatrixAt(i, part)

            const hair = this.hair.get(look.hairStyle)
            if (hair)
            {
                const n = counts.get(look.hairStyle) ?? 0
                hair.setMatrixAt(n, part)
                counts.set(look.hairStyle, n + 1)
            }
        })

        for (const mesh of [this.body, this.head, this.eyes, ...this.hair.values()])
        {
            mesh.instanceMatrix.needsUpdate = true
        }
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
const tmpPos = new Vector3()
const tmpScale = new Vector3()
