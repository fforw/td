import { DataTexture, FloatType, type Material, RGFormat, Vector2, Vector4 } from "three"
import { SPACE_CELL, type SpaceGrid, THICK_WALL_CUT_DEPTH } from "../map/nearWalls"

/**
 * How much of a cut wall still shows
 */
export const CUT_OPACITY = 0.3

/**
 * Seconds a wall takes to turn see-through or solid again. Spaces can be a few steps across, and walls that change at
 * once blink on the way through them.
 */
export const CUT_FADE = 0.3

/**
 * How many spaces can have their near walls cut at once, counting those whose walls are still turning solid
 */
export const OPEN_SPACES = 4

/**
 * Makes the walls between the camera and the spaces that are open see-through, for a view from a fixed side. Walls know
 * the spaces they are near for from the "nearSpace" attribute of their meshes, see map/nearWalls.ts.
 *
 * Walls get drawn twice for that, by two meshes with the same geometry: one leaves out what is cut at all, the other one
 * only draws that, as see-through as it is cut and without writing depth. A single see-through wall would write its depth
 * first and leave a hole in the solid walls behind it.
 */
export interface WallCut
{
    uniforms: {
        /** the open spaces, -1 for none */
        openSpaces: { value: Vector4 }
        /** how far their near walls are cut, 0 to 1 */
        openAmounts: { value: Vector4 }
    }
}


export function createWallCut(): WallCut
{
    return {
        uniforms: {
            openSpaces: { value: new Vector4(-1, -1, -1, -1) },
            openAmounts: { value: new Vector4(0, 0, 0, 0) }
        }
    }
}


/**
 * Moves the walls on by a frame: those near for the given spaces get cut more, all others less
 *
 * @param cut       wall cut
 * @param spaces    spaces to have open, no more than OPEN_SPACES
 * @param delta     seconds since the last frame
 */
export function updateWallCut({ uniforms }: WallCut, spaces: readonly number[], delta: number): void
{
    const ids = uniforms.openSpaces.value
    const amounts = uniforms.openAmounts.value
    const step = delta / CUT_FADE

    for (const space of spaces)
    {
        let slot = -1
        for (let i = 0; i < OPEN_SPACES; i++)
        {
            if (ids.getComponent(i) === space)
            {
                slot = i
                break
            }
            // else the one that is cut the least, of those that aren't asked for
            if (!spaces.includes(ids.getComponent(i)) && (slot < 0 || amounts.getComponent(i) < amounts.getComponent(slot)))
            {
                slot = i
            }
        }
        if (slot >= 0 && ids.getComponent(slot) !== space)
        {
            ids.setComponent(slot, space)
            amounts.setComponent(slot, 0)
        }
    }

    for (let i = 0; i < OPEN_SPACES; i++)
    {
        const open = spaces.includes(ids.getComponent(i))
        const amount = Math.max(0, Math.min(1, amounts.getComponent(i) + (open ? step : -step)))
        amounts.setComponent(i, amount)
        if (amount === 0 && !open)
        {
            ids.setComponent(i, -1)
        }
    }
}


/**
 * Makes the given material draw one side of the cut. It adds to what the material does to its shader already, and has to
 * come after that.
 *
 * @param material  material of walls
 * @param cut       wall cut
 * @param glass     whether to draw only the cut walls and see-through, instead of only the others
 */
export function applyWallCut(material: Material, { uniforms }: WallCut, glass: boolean): void
{
    const before = material.onBeforeCompile
    const keyBefore = material.customProgramCacheKey()

    if (glass)
    {
        material.transparent = true
        material.depthWrite = false
    }

    material.onBeforeCompile = (shader, renderer) => {
        before.call(material, shader, renderer)
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", /* glsl */`
                #include <common>
                attribute vec2 nearSpace;
                uniform vec4 openSpaces;
                uniform vec4 openAmounts;
                varying float vWallCut;

                float wallCut(float space)
                {
                    float cut = 0.0;
                    for (int i = 0; i < ${OPEN_SPACES}; i++)
                    {
                        if (space > 0.5 && abs(openSpaces[i] - space) < 0.5)
                        {
                            cut = max(cut, openAmounts[i]);
                        }
                    }
                    return cut;
                }
            `)
            .replace("#include <project_vertex>", /* glsl */`
                #include <project_vertex>
                vWallCut = max(wallCut(nearSpace.x), wallCut(nearSpace.y));
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying float vWallCut;`)
            .replace("#include <clipping_planes_fragment>", /* glsl */`
                #include <clipping_planes_fragment>
                if (vWallCut ${glass ? "<=" : ">"} 0.001)
                {
                    discard;
                }
                ${glass ? `diffuseColor.a *= mix(1.0, ${CUT_OPACITY.toFixed(3)}, vWallCut);` : ""}
            `)
    }
    material.customProgramCacheKey = () => keyBefore + (glass ? "-wall-glass" : "-wall-cut")
    material.needsUpdate = true
}


/**
 * Least way over the floor in world units that counts as seen past the inside of a wall. The outline of walls stays clear
 * of the faces of the floor a bit.
 */
const MIN_INSIDE_REACH = 0.25

/**
 * How many places along the line of sight get looked at for floor
 */
const INSIDE_STEPS = 24


/**
 * Makes the material of the insides of thick walls only draw what hides other spaces than the open ones. Each fragment
 * follows its line of sight down to the floor, and makes way if it comes to an open space with no wall before that, or if
 * there is no floor at all. Floor of another space counts as open if an open space follows it straight on within the depth
 * of the cut, as the wall in front gets cut for both then. The walls on the way count as they would show, lit by the space
 * in front of them. What is seen
 * past a place of a wall depends on where the camera is, so nothing that is fixed to the geometry would do.
 *
 * @param material  material of the insides
 * @param cut       wall cut
 * @param grid      spaces of the level
 */
export function applyInsideCut(material: Material, { uniforms }: WallCut, { minX, minZ, width, height, cells }: SpaceGrid): void
{
    const spaceGrid = new DataTexture(cells, width, height, RGFormat, FloatType)
    spaceGrid.needsUpdate = true
    const own = {
        spaceGrid: { value: spaceGrid },
        spaceGridMin: { value: new Vector2(minX, minZ) },
        spaceGridSize: { value: new Vector2(width * SPACE_CELL, height * SPACE_CELL) }
    }

    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms, own)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\nvarying vec3 vInside;`)
            .replace("#include <project_vertex>", /* glsl */`
                #include <project_vertex>
                vInside = (modelMatrix * vec4(transformed, 1.0)).xyz;
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", /* glsl */`
                #include <common>
                varying vec3 vInside;
                uniform vec4 openSpaces;
                uniform vec4 openAmounts;
                uniform sampler2D spaceGrid;
                uniform vec2 spaceGridMin;
                uniform vec2 spaceGridSize;

                bool isOpen(float space)
                {
                    for (int i = 0; i < ${OPEN_SPACES}; i++)
                    {
                        if (openAmounts[i] > 0.001 && abs(openSpaces[i] - space) < 0.5)
                        {
                            return true;
                        }
                    }
                    return false;
                }

                // the space at a place, -1 for a thick wall, and one more than the space a thin wall there is near for
                vec2 spaceCell(vec2 place)
                {
                    vec2 uv = (place - spaceGridMin) / spaceGridSize;
                    return any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))
                        ? vec2(-1.0, 0.0) : textureLod(spaceGrid, uv, 0.0).rg;
                }

                bool makesWay()
                {
                    vec3 ray = vInside - cameraPosition;
                    float across = max(length(ray.xz), 1e-4);
                    float reach = max(${MIN_INSIDE_REACH.toFixed(3)}, vInside.y * across / max(-ray.y, 1e-4));
                    vec2 way = ray.xz / across * reach;
                    // whether there was floor of another space
                    bool other = false;
                    for (int i = 0; i <= ${INSIDE_STEPS}; i++)
                    {
                        vec2 cell = spaceCell(vInside.xz + way * float(i) / ${INSIDE_STEPS.toFixed(1)});
                        // walls standing on that floor, without the gap between thick walls and the floor
                        if (other && (cell.r < -0.5 || cell.g > 0.5 && !isOpen(cell.g - 1.0)))
                        {
                            return false;
                        }
                        if (cell.r > 0.5)
                        {
                            if (isOpen(cell.r))
                            {
                                return true;
                            }
                            other = true;
                        }
                    }
                    if (!other)
                    {
                        return true;
                    }
                    // a strip of another space in front of an open one shows through the cut anyway, see thickWallSpaces()
                    vec2 end = vInside.xz + way;
                    vec2 ahead = way / reach * ${THICK_WALL_CUT_DEPTH.toFixed(3)};
                    for (int i = 1; i <= ${INSIDE_STEPS}; i++)
                    {
                        vec2 cell = spaceCell(end + ahead * float(i) / ${INSIDE_STEPS.toFixed(1)});
                        if (cell.r < -0.5 || cell.g > 0.5 && !isOpen(cell.g - 1.0))
                        {
                            return false;
                        }
                        if (cell.r > 0.5 && isOpen(cell.r))
                        {
                            return true;
                        }
                    }
                    return false;
                }
            `)
            .replace("#include <clipping_planes_fragment>", /* glsl */`
                #include <clipping_planes_fragment>
                if (makesWay())
                {
                    discard;
                }
            `)
    }
    material.customProgramCacheKey = () => "wall-inside"
    material.needsUpdate = true
}
