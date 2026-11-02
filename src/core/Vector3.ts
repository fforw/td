/**
 * The part of three.js' Vector3 the map code needs, with the same behavior. Importing Vector3 from three pulls all of
 * three's core into the bundle, which the map worker doesn't need.
 */
export default class Vector3
{
    x: number
    y: number
    z: number

    constructor(x = 0, y = 0, z = 0)
    {
        this.x = x
        this.y = y
        this.z = z
    }

    clone(): Vector3
    {
        return new Vector3(this.x, this.y, this.z)
    }

    copy(v: Vector3): this
    {
        this.x = v.x
        this.y = v.y
        this.z = v.z
        return this
    }

    add(v: Vector3): this
    {
        this.x += v.x
        this.y += v.y
        this.z += v.z
        return this
    }

    sub(v: Vector3): this
    {
        this.x -= v.x
        this.y -= v.y
        this.z -= v.z
        return this
    }

    addScaledVector(v: Vector3, s: number): this
    {
        this.x += v.x * s
        this.y += v.y * s
        this.z += v.z * s
        return this
    }

    multiplyScalar(s: number): this
    {
        this.x *= s
        this.y *= s
        this.z *= s
        return this
    }

    divideScalar(s: number): this
    {
        return this.multiplyScalar(1 / s)
    }

    length(): number
    {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
    }

    normalize(): this
    {
        return this.divideScalar(this.length() || 1)
    }

    distanceTo(v: Vector3): number
    {
        const dx = this.x - v.x
        const dy = this.y - v.y
        const dz = this.z - v.z
        return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }

    lerp(v: Vector3, alpha: number): this
    {
        this.x += (v.x - this.x) * alpha
        this.y += (v.y - this.y) * alpha
        this.z += (v.z - this.z) * alpha
        return this
    }
}
