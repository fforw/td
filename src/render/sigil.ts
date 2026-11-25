import {
    AddEquation,
    Color,
    CustomBlending,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    OneFactor,
    OneMinusSrcAlphaFactor,
    PlaneGeometry,
    ShaderMaterial,
    Vector4
} from "three"
import { setGlowingLess } from "./glowView"
import { SIGIL_STROKES, sigilPhase, strokeProgress } from "./sigilShape"

/*
 * A sigil on the floor, as blue wizards cast it: it draws itself in thin, dim lines, flares up blue-white and hurts, with
 * a curtain of light rising from its circle, and dissolves. The strokes are distances in the shader of a single quad, so
 * they are sharp from any distance. The output is premultiplied, so one pass both covers the floor, which keeps the color
 * on bright floors, and adds light. A GlowView adds some bloom.
 */

/**
 * Height over the floor in world units, above the sills of doors
 */
const HEIGHT = 0.025

/**
 * Half the size of the quad in units of the radius, with room for the halo
 */
const EXTENT = 1.3

/**
 * Height of the curtain of light in units of the radius
 */
const CURTAIN_HEIGHT = 0.45

/**
 * How much the hue varies between wizards to both sides, in turns
 */
export const SIGIL_HUE_RANGE = 12 / 360

/**
 * Hue in turns, saturation and lightness of the warning
 */
const HUE = 222 / 360
const SATURATION = 0.85
const LIGHTNESS = 0.5

/**
 * How much of its light goes into the bloom, little enough for the strokes to stay clear
 */
const GLOW_SHARE = 0.18

const COUNT = SIGIL_STROKES.length

const QUAD_VERTEX = `
varying vec2 vPoint;

void main()
{
    vPoint = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// a stroke is x0, y0, x1, y1 for a line and x, y, radius for a circle
const QUAD_FRAGMENT = `
uniform vec4 strokes[COUNT];
uniform float progress[COUNT];
uniform bool isLine[COUNT];
uniform vec3 color;
uniform float power;
uniform float flash;
uniform float opacity;
uniform float glowShare;
uniform float time;
varying vec2 vPoint;

vec3 outputColor(vec3 c)
{
    return linearToOutputTexel(vec4(c, 1.0)).rgb;
}

void main()
{
    float pixel = max(fwidth(vPoint.x), fwidth(vPoint.y));
    float d = 1e3;
    float tip = 1e3;
    for (int i = 0; i < COUNT; i++)
    {
        float p = progress[i];
        if (p <= 0.0)
        {
            continue;
        }
        vec4 s = strokes[i];
        vec2 end;
        float distance;
        if (isLine[i])
        {
            end = mix(s.xy, s.zw, p);
            vec2 along = end - s.xy;
            float t = clamp(dot(vPoint - s.xy, along) / max(dot(along, along), 1e-8), 0.0, 1.0);
            distance = length(vPoint - s.xy - along * t);
        }
        else
        {
            vec2 off = vPoint - s.xy;
            float a = p * 6.2831853;
            end = s.xy + s.z * vec2(sin(a), -cos(a));
            // clockwise from the top
            float angle = atan(off.x, -off.y);
            angle += angle < 0.0 ? 6.2831853 : 0.0;
            distance = angle <= a
                ? abs(length(off) - s.z)
                : min(length(vPoint - end), length(off - vec2(0.0, -s.z)));
        }
        d = min(d, distance);
        if (p < 1.0)
        {
            tip = min(tip, length(vPoint - end));
        }
    }

    float halfWidth = max(mix(0.014, 0.033, power), pixel * 0.6);
    float line = 1.0 - smoothstep(halfWidth - pixel * 0.7, halfWidth + pixel * 0.7, d);
    float outside = max(0.0, d - halfWidth);
    float border = 1.0 - smoothstep(1.05, EXTENT, length(vPoint));
    float flicker = 0.92 + 0.08 * sin(time * 17.0 + vPoint.x * 5.0) * sin(time * 11.0 + vPoint.y * 5.0);
    float halo = (exp(-outside * 16.0) * 0.8 + exp(-outside * 5.0) * 0.3) * border * power * flicker;
    halo += exp(-outside * 45.0) * 0.12 * (1.0 - power);
    float spark = exp(-tip * tip * 900.0) + 0.3 * exp(-tip * 14.0);
    float disc = (1.0 - smoothstep(0.95, 1.0, length(vPoint))) * flash;

    vec3 base = outputColor(color);
    vec3 pale = outputColor(mix(color, vec3(1.0), 0.35));
    vec3 hot = outputColor(mix(color, vec3(1.0), 0.85));
    vec3 lineColor = mix(base * 0.85, hot, power);

    // what it covers, in its color, and the light it adds
    float cover = line * mix(0.75, 1.0, power);
    float tint = (1.0 - cover) * min(0.75, halo * 1.1);
    vec3 light = pale * halo * 0.3 * (1.0 - line) + hot * (spark * (1.0 - power) + disc * 0.25) + vec3(line * flash);
    gl_FragColor = vec4(lineColor * cover + base * tint + light, cover + tint) * opacity;
    gl_FragColor.rgb *= glowShare;
}
`

const CURTAIN_VERTEX = `
varying vec3 vPoint;

void main()
{
    vPoint = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const CURTAIN_FRAGMENT = `
uniform vec3 color;
uniform float power;
uniform float flash;
uniform float glowShare;
uniform float time;
varying vec3 vPoint;

void main()
{
    float h = vPoint.y / CURTAIN_HEIGHT;
    float angle = atan(vPoint.x, vPoint.z);
    // whole numbers of waves around, so there is no seam
    float waves = sin(angle * 9.0 + time * 2.3) * sin(angle * 14.0 - time * 3.1) + 0.6 * sin(angle * 31.0 + time * 5.0);
    float top = 0.65 + 0.2 * waves + 0.3 * flash;
    float light = pow(clamp(1.0 - h / top, 0.0, 1.0), 1.6) * (0.4 + 0.4 * flash);
    vec3 c = linearToOutputTexel(vec4(mix(color, vec3(1.0), 0.3 * (1.0 - h) + 0.4 * flash), 1.0)).rgb;
    gl_FragColor = vec4(c * light * power * glowShare, 0.0);
}
`


/**
 * Returns a color for the sigils of a wizard, so those of two can be told apart
 *
 * @param random    from 0 to 1
 */
export function sigilColor(random: number): Color
{
    return new Color().setHSL(HUE + (random * 2 - 1) * SIGIL_HUE_RANGE, SATURATION, LIGHTNESS)
}


function createMaterial(uniforms: ShaderMaterial["uniforms"], vertexShader: string, fragmentShader: string): ShaderMaterial
{
    return new ShaderMaterial({
        // each has glowShare on its own
        uniforms: { ...uniforms },
        defines: {
            COUNT,
            EXTENT: EXTENT.toFixed(3),
            CURTAIN_HEIGHT: CURTAIN_HEIGHT.toFixed(3)
        },
        vertexShader,
        fragmentShader,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        side: DoubleSide
    })
}


export default class Sigil
{
    readonly group = new Group()

    private readonly uniforms: {
        strokes: { value: Vector4[] }
        progress: { value: number[] }
        isLine: { value: boolean[] }
        color: { value: Color }
        power: { value: number }
        flash: { value: number }
        opacity: { value: number }
        time: { value: number }
    }
    private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>
    private readonly curtain: Mesh<CylinderGeometry, ShaderMaterial>

    /**
     * @param color     color of the warning, see sigilColor()
     */
    constructor(color: Color)
    {
        this.uniforms = {
            strokes: {
                value: SIGIL_STROKES.map(stroke => stroke.type === "line"
                    ? new Vector4(stroke.x0, stroke.y0, stroke.x1, stroke.y1)
                    : new Vector4(stroke.cx, stroke.cy, stroke.r, 0))
            },
            progress: { value: new Array<number>(COUNT).fill(0) },
            isLine: { value: SIGIL_STROKES.map(({ type }) => type === "line") },
            color: { value: color.clone() },
            power: { value: 0 },
            flash: { value: 0 },
            opacity: { value: 0 },
            time: { value: 0 }
        }
        const quadGeometry = new PlaneGeometry(EXTENT * 2, EXTENT * 2)
        quadGeometry.rotateX(-Math.PI / 2)
        this.quad = new Mesh(quadGeometry, createMaterial(this.uniforms, QUAD_VERTEX, QUAD_FRAGMENT))
        const curtainGeometry = new CylinderGeometry(1, 1, CURTAIN_HEIGHT, 48, 1, true)
        curtainGeometry.translate(0, CURTAIN_HEIGHT / 2, 0)
        this.curtain = new Mesh(curtainGeometry, createMaterial(this.uniforms, CURTAIN_VERTEX, CURTAIN_FRAGMENT))
        this.curtain.renderOrder = 1

        setGlowingLess(this.quad, GLOW_SHARE)
        setGlowingLess(this.curtain, GLOW_SHARE)
        this.group.add(this.quad, this.curtain)
        this.group.visible = false
    }

    setColor(color: Color): void
    {
        this.uniforms.color.value.copy(color)
    }

    /**
     * Places it on the floor, with everything in world units
     */
    place(x: number, z: number, radius: number): void
    {
        this.group.scale.setScalar(radius)
        this.group.position.set(x, HEIGHT, z)
    }

    /**
     * @param time      seconds since it was cast
     * @param broken    seconds since it was broken off, null if it wasn't
     */
    update(time: number, broken: number | null = null): void
    {
        const { uniforms } = this
        const { drawn, power, flash, opacity } = sigilPhase(time, broken)
        this.group.visible = opacity > 0
        this.curtain.visible = power > 0
        uniforms.power.value = power
        uniforms.flash.value = flash
        uniforms.opacity.value = opacity
        uniforms.time.value = time
        SIGIL_STROKES.forEach((stroke, i) => {
            uniforms.progress.value[i] = strokeProgress(stroke, drawn)
        })
    }

    dispose(): void
    {
        for (const { geometry, material } of [this.quad, this.curtain])
        {
            geometry.dispose()
            material.dispose()
        }
    }
}
