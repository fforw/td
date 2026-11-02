export function clamp(v: number): number
{
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
