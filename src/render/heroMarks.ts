import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry } from "three"

/**
 * Height over the floor in world units
 */
const HEIGHT = 0.02

/**
 * Distance of the aim mark from the hero, and its size, in world units
 */
const AIM_DISTANCE = 0.3
const AIM_SIZE = 0.07
const AIM_OPACITY = 0.6

/**
 * Inner and outer radius of the arc of a slash in world units, its width in radians, how visible it starts, and how many
 * seconds it takes to fade
 */
const SLASH_INNER = 0.2
const SLASH_OUTER = 0.55
const SLASH_WIDTH = 2.2
const SLASH_OPACITY = 0.85
const SLASH_FADE = 0.2


function createMark(geometry: RingGeometry | ShapeGeometry, opacity: number): Mesh<RingGeometry | ShapeGeometry, MeshBasicMaterial>
{
    // the sticks have to be readable anywhere, also in the dark. The geometries are in the plane of x and y, facing along y.
    geometry.rotateX(Math.PI / 2)
    const material = new MeshBasicMaterial({ color: "#fff4d8", transparent: true, opacity, depthWrite: false, side: DoubleSide, toneMapped: false })
    return new Mesh(geometry, material)
}


/**
 * What's shown on the floor for the hero under control, as a meeple from above doesn't show well where it looks and what it
 * does with an item held along its body.
 */
export default class HeroMarks
{
    readonly group = new Group()

    private readonly aim: Mesh
    private readonly slashArc: Mesh<RingGeometry | ShapeGeometry, MeshBasicMaterial>
    /** when the last slash starts to show, in seconds */
    private slashAt = -Infinity

    constructor()
    {
        const arrow = new Shape()
        arrow.moveTo(-AIM_SIZE, AIM_DISTANCE)
        arrow.lineTo(0, AIM_DISTANCE + AIM_SIZE)
        arrow.lineTo(AIM_SIZE, AIM_DISTANCE)
        arrow.lineTo(0, AIM_DISTANCE + AIM_SIZE * 0.4)
        this.aim = createMark(new ShapeGeometry(arrow), AIM_OPACITY)

        this.slashArc = createMark(
            new RingGeometry(SLASH_INNER, SLASH_OUTER, 16, 1, (Math.PI - SLASH_WIDTH) / 2, SLASH_WIDTH),
            SLASH_OPACITY
        )
        this.slashArc.visible = false
        this.group.add(this.aim, this.slashArc)
        this.group.position.y = HEIGHT
    }

    /**
     * Has a slash show from the given time on, in seconds
     */
    slash(time: number): void
    {
        this.slashAt = time
    }

    /**
     * Follows the hero
     *
     * @param x         position in world units
     * @param z         position in world units
     * @param facing    where the hero looks, as a meeple facing
     * @param aiming    show where they look
     * @param time      time in seconds
     */
    update(x: number, z: number, facing: number, aiming: boolean, time: number): void
    {
        const { group, aim, slashArc, slashAt } = this
        group.position.x = x
        group.position.z = z
        group.rotation.y = facing
        aim.visible = aiming

        const share = (time - slashAt) / SLASH_FADE
        slashArc.visible = share >= 0 && share < 1
        slashArc.material.opacity = SLASH_OPACITY * (1 - share)
    }
}
