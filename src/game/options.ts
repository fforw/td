/**
 * What the player can set up, which goes for all campaigns and so isn't part of a save
 */
export interface Options
{
    /** meeples on a journey go at the pace of their walk cycle instead of hurrying */
    waddle: boolean
}

const DEFAULTS: Options = {
    waddle: false
}

const STORAGE_KEY = "td.options"


/**
 * Returns the options written as JSON, with the defaults for all that isn't there or can't be read
 */
export function parseOptions(json: string | null): Options
{
    try
    {
        return { ...DEFAULTS, ...JSON.parse(json ?? "{}") }
    }
    catch (e)
    {
        console.warn("Ignoring the options", e)
        return { ...DEFAULTS }
    }
}


export function loadOptions(): Options
{
    try
    {
        return parseOptions(localStorage.getItem(STORAGE_KEY))
    }
    catch (e)
    {
        console.warn("Can't read the options", e)
        return parseOptions(null)
    }
}


export function saveOptions(options: Options): void
{
    try
    {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
    }
    catch (e)
    {
        console.warn("Can't write the options", e)
    }
}
