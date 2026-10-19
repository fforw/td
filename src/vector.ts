const sqrt = Math.sqrt;

class Vector
{
    x: number;
    y: number;

    constructor(x: number, y: number)
    {
        this.x = x;
        this.y = y;
    }

    /**
     * Returns a copy of this vector.
     *
     * @returns {Vector} copy
     */
    copy(): Vector
    {
        return new Vector(this.x,this.y);
    }

    /**
     * Adds to this vector
     *
     * @param x     {number|Vector} x coordinate or a vector
     * @param y     {number?} y coordinate, ignored if x is a vector
     * @returns {Vector} this vector
     */

    add(v: Vector): Vector
    add(x: number, y: number): Vector
    add(x: number | Vector, y?: number): Vector
    {
        if (typeof x === "number")
        {
            this.x += x;
            this.y += y!;
        }
        else
        {
            this.x += x.x;
            this.y += x.y;
        }

        return this;
    }

    /**
     * Subtracts from this vector
     *
     * @param x     {number|Vector} x coordinate or a vector
     * @param y     {number?} y coordinate, ignored if x is a vector
     * @returns {Vector} this vector
     */
    subtract(v: Vector): Vector
    subtract(x: number, y: number): Vector
    subtract(x: number | Vector, y?: number): Vector
    {
        if (typeof x === "number")
        {
            this.x -= x;
            this.y -= y!;
        }
        else
        {
            this.x -= x.x;
            this.y -= x.y;
        }

        return this;
    }

    /**
     * Scales the vector by a planar number.
     *
     * @param n     scale
     * @returns {Vector} this vector, scaled
     */
    scale(n: number): Vector
    {
        this.x *= n;
        this.y *= n;

        return this;
    }

    /**
     * Length of this vector
     *
     * @returns {number}    length
     */
    length(): number
    {
        const { x, y } = this;
        return sqrt(x*x+y*y);
    }

    /**
     * Scales the vector to normal length or a specified length
     *
     * @param targetLength      {number?} target length of the vector (default is 1, the normal vector length)
     *
     * @returns {Vector}
     */
    norm(targetLength = 1): Vector
    {
        return this.scale(targetLength / this.length());
    }

    /**
     * Rotate vector 90 degrees clockwise.
     *
     * @returns {Vector}
     */
    rotateClockwise(): Vector
    {
        const { x, y } = this;

        //noinspection JSSuspiciousNameCombination
        this.x = y;
        this.y = -x;

        return this;
    }

    /**
     * Rotate vector 90 degrees counter clockwise.
     *
     * @returns {Vector}
     */
    rotateCounterClockwise(): Vector
    {
        const { x, y } = this;

        this.x = -y;
        //noinspection JSSuspiciousNameCombination
        this.y = x;

        return this;
    }

    /**
     * Sets the coordinates of this vector
     *
     * @param x     {number|Vector} x coordinate or a vector
     * @param y     {number?} y coordinate, ignored if x is a vector
     */
    set(v: Vector): void
    set(x: number, y: number): void
    set(x: number | Vector, y?: number): void
    {
        if (typeof x === "number")
        {
            this.x = x;
            this.y = y!;
        }
        else
        {
            this.x = x.x;
            this.y = x.y;
        }

    }
}

export default Vector;
