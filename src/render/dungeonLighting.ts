import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    HalfFloatType,
    LinearFilter,
    type Material,
    type MeshBasicMaterial,
    type PixelFormat,
    RGBAFormat,
    RGFormat,
    Vector2
} from "three"
import {
    LIGHT_TEXELS,
    type LevelLighting,
    RIM_FADE_END,
    RIM_FADE_START,
    RIM_GATE_END,
    RIM_GATE_START
} from "../map/dungeonLights"

/*
 * Materials lit by the baked light field of a dungeon level. Everything looks up the light of its position, so moving things
 * cost the same as walls, no matter how many lights there are.
 */

/**
 * Light of the field for the shaded materials. The shaded materials divide by PI.
 */
const LIGHT_GAIN = 6

/**
 * Height of the lights over the plane for the direction of the light. A flat direction leaves no light on the floor.
 */
const LIGHT_ELEVATION = 1

/**
 * How far surfaces look up their light in front of them in world units, to stay on their own side of a thin wall. A wall
 * looks at the floor in front of it.
 */
const NORMAL_OFFSET = 0.13

/**
 * Share of white in the color of the rim
 */
const RIM_PALE = 0.6

/**
 * Brightness of the rim. It isn't tone mapped, so it stays bright against the dark.
 */
const RIM_BRIGHTNESS = 1

/**
 * How much thicker than the outline the rim gets
 */
const RIM_WIDEN = 0.6

const PARS = /* glsl */`
    uniform sampler2D lightColors;
    uniform sampler2D lightDirections;
    uniform vec2 lightOrigin;
    uniform vec2 lightSize;
`


/**
 * Textures and uniforms of a baked light field
 */
export interface LightField
{
    uniforms: {
        lightColors: { value: DataTexture }
        lightDirections: { value: DataTexture }
        lightOrigin: { value: Vector2 }
        lightSize: { value: Vector2 }
    }
}


function createTexture(data: Float32Array, width: number, height: number, format: PixelFormat): DataTexture
{
    const half = new Uint16Array(data.length)
    for (let i = 0; i < data.length; i++)
    {
        half[i] = DataUtils.toHalfFloat(data[i])
    }

    const texture = new DataTexture(half, width, height, format, HalfFloatType)
    texture.magFilter = texture.minFilter = LinearFilter
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
}


/**
 * Creates the light field for a baked level
 */
export function createLightField({ minX, minZ, width, height, colors, directions }: LevelLighting): LightField
{
    return {
        uniforms: {
            lightColors: { value: createTexture(colors, width, height, RGBAFormat) },
            lightDirections: { value: createTexture(directions, width, height, RGFormat) },
            lightOrigin: { value: new Vector2(minX, minZ) },
            lightSize: { value: new Vector2(width / LIGHT_TEXELS, height / LIGHT_TEXELS) }
        }
    }
}


/**
 * Makes the given lit material add the light of the field to its other lights, through its own way of shading. That keeps
 * the bands of toon materials.
 */
export function applyLightField(material: Material, { uniforms }: LightField): void
{
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\nvarying vec2 vLightPosition;`)
            .replace("#include <project_vertex>", /* glsl */`
                #include <project_vertex>
                vec4 lightPosition = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                lightPosition = instanceMatrix * lightPosition;
                #endif
                vLightPosition = (modelMatrix * lightPosition).xz;
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying vec2 vLightPosition;\n${PARS}`)
            .replace("#include <lights_fragment_begin>", /* glsl */`
                #include <lights_fragment_begin>
                {
                    vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
                    vec2 uv = (vLightPosition + worldNormal.xz * ${NORMAL_OFFSET.toFixed(3)} - lightOrigin) / lightSize;
                    vec2 toLight = texture2D(lightDirections, uv).rg;
                    toLight /= max(length(toLight), 0.02);
                    vec3 worldDirection = normalize(vec3(toLight.x, ${LIGHT_ELEVATION.toFixed(3)}, toLight.y));

                    directLight.color = texture2D(lightColors, uv).rgb * ${LIGHT_GAIN.toFixed(3)};
                    directLight.direction = normalize((viewMatrix * vec4(worldDirection, 0.0)).xyz);
                    directLight.visible = true;
                    RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                }
            `)
    }
    material.customProgramCacheKey = () => "light-field"
    material.needsUpdate = true
}


/**
 * Makes the given outline material turn into a rim on the side a light comes from, where its meeple stands in the dark and
 * the light still reaches it. It replaces what the material does with its shape.
 *
 * @param material      material of the hull around a part
 * @param field         light field
 * @param outline       thickness of the outline
 */
export function applyRimLight(material: MeshBasicMaterial, { uniforms }: LightField, outline: number): void
{
    material.toneMapped = false
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\nvarying float vRim;\nvarying vec3 vRimColor;\n${PARS}`)
            .replace("#include <begin_vertex>", /* glsl */`
                #include <begin_vertex>
                mat4 rimMatrix = modelMatrix * instanceMatrix;
                vec2 rimUv = ((rimMatrix * vec4(transformed, 1.0)).xz - lightOrigin) / lightSize;
                vec4 rimField = texture2D(lightColors, rimUv);
                vec2 rimDirection = texture2D(lightDirections, rimUv).rg;
                float rimOwn = length(rimDirection);

                vRim = smoothstep(${RIM_FADE_START.toFixed(3)}, ${RIM_FADE_END.toFixed(3)}, rimOwn)
                    * (1.0 - smoothstep(${RIM_GATE_START.toFixed(3)}, ${RIM_GATE_END.toFixed(3)}, rimField.a))
                    * smoothstep(0.0, 0.7, dot(normalize(mat3(rimMatrix) * normal).xz, rimDirection / max(rimOwn, 1e-4)));

                vec3 rimHue = rimField.rgb / max(max(rimField.r, max(rimField.g, rimField.b)), 1e-4);
                vRimColor = mix(rimHue, vec3(1.0), ${RIM_PALE.toFixed(3)}) * ${RIM_BRIGHTNESS.toFixed(3)};

                transformed += normal * ${outline.toFixed(4)} * (1.0 + vRim * ${RIM_WIDEN.toFixed(3)});
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying float vRim;\nvarying vec3 vRimColor;`)
            .replace("#include <color_fragment>", /* glsl */`
                #include <color_fragment>
                diffuseColor.rgb = mix(diffuseColor.rgb, vRimColor, vRim);
            `)
    }
    material.customProgramCacheKey = () => "rim-light"
    material.needsUpdate = true
}
