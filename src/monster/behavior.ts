/**
 * Behavior trees for monsters. A tree is shared by all monsters of a kind and holds no state of its own: what a monster
 * is doing is in its Memory. Structure is data, so it can be walked to show what a monster does, while leaves are code.
 *
 * Only leaves act. Conditions only read, so going through the tree again each frame never changes anything by itself.
 */

export type Status = "success" | "failure" | "running"

/**
 * What a tree keeps for each monster
 */
export interface Memory
{
    /** index of the leaf that was running after the last frame, -1 for none */
    running: number
}

export function memory(): Memory
{
    return { running: -1 }
}

/**
 * Monster with a memory, as trees see it
 */
export interface Agent
{
    memory: Memory
    /** how good it is at what it does, from 0 to 1, which gates and tunes branches */
    skill: number
}

/**
 * Something a monster does
 */
export interface Leaf<M extends Agent, C>
{
    type: "leaf"
    name: string
    /**
     * A committed leaf runs until it ends itself or gets interrupted, without the tree being gone through. Moves with a
     * warning and a fixed timing are committed, so the warning always means what it says.
     */
    commits: boolean
    /**
     * Starts it, false if it can't start now, which counts as a failure
     */
    start?(monster: M, context: C): boolean
    tick(monster: M, context: C): Status
    /**
     * Ends it before it ended itself, because another branch took over or something interrupted it
     */
    stop?(monster: M): void
}

export interface Condition<M extends Agent, C>
{
    type: "condition"
    name: string
    test(monster: M, context: C): boolean
}

/**
 * A selector goes on with the first child that doesn't fail, a sequence with the first that doesn't succeed
 */
export interface Composite<M extends Agent, C>
{
    type: "selector" | "sequence"
    name: string
    children: readonly Node<M, C>[]
}

export type Node<M extends Agent, C> = Leaf<M, C> | Condition<M, C> | Composite<M, C>

/**
 * What a leaf does, for leaf()
 */
export type LeafSpec<M extends Agent, C> = Omit<Leaf<M, C>, "type" | "name" | "commits"> & { commits?: boolean }

export function leaf<M extends Agent, C>(name: string, spec: LeafSpec<M, C>): Leaf<M, C>
{
    return { type: "leaf", name, commits: false, ...spec }
}

export function condition<M extends Agent, C>(name: string, test: (monster: M, context: C) => boolean): Condition<M, C>
{
    return { type: "condition", name, test }
}

/**
 * Succeeds for monsters with at least the given skill, which keeps the branches after it for better ones
 */
export function skilled<M extends Agent, C>(least: number): Condition<M, C>
{
    return condition(`skill ${least}`, ({ skill }) => skill >= least)
}

export function selector<M extends Agent, C>(name: string, ...children: Node<M, C>[]): Composite<M, C>
{
    return { type: "selector", name, children }
}

export function sequence<M extends Agent, C>(name: string, ...children: Node<M, C>[]): Composite<M, C>
{
    return { type: "sequence", name, children }
}


/**
 * A tree built from nodes, which it numbers. The same node object must not appear twice in it.
 */
export class Tree<M extends Agent, C>
{
    private readonly nodes: Node<M, C>[] = []
    private readonly parents: number[] = []
    private readonly indices = new Map<Node<M, C>, number>()

    /** leaf found running in the current frame */
    private active = -1

    constructor(readonly root: Node<M, C>)
    {
        this.number(root, -1)
    }

    /**
     * Has a monster go on by a frame: a committed leaf that runs goes on by itself, otherwise the tree is gone through from
     * the root, and a leaf that ran before and didn't get chosen again is stopped
     */
    tick(monster: M, context: C): void
    {
        const { memory } = monster
        const running = memory.running >= 0 ? this.nodes[memory.running] as Leaf<M, C> : null
        if (running?.commits)
        {
            if (running.tick(monster, context) !== "running")
            {
                memory.running = -1
            }
            return
        }
        this.active = -1
        this.run(this.root, monster, context)
        if (running && memory.running !== this.active)
        {
            running.stop?.(monster)
        }
        memory.running = this.active
    }

    /**
     * Stops what a monster is doing, e.g. when it gets hit. The next tick goes through the tree again.
     */
    interrupt(monster: M): void
    {
        const { memory } = monster
        if (memory.running >= 0)
        {
            const running = this.nodes[memory.running] as Leaf<M, C>
            memory.running = -1
            running.stop?.(monster)
        }
    }

    /**
     * Returns the names of the nodes from the root to the leaf a monster runs, or an empty list if none runs
     */
    path({ memory }: M): string[]
    {
        const path: string[] = []
        for (let index = memory.running; index >= 0; index = this.parents[index])
        {
            path.unshift(this.nodes[index].name)
        }
        return path
    }

    private number(node: Node<M, C>, parent: number): void
    {
        if (this.indices.has(node))
        {
            throw new Error(`Node ${node.name} appears twice`)
        }
        const index = this.nodes.length
        this.nodes.push(node)
        this.parents.push(parent)
        this.indices.set(node, index)
        if (node.type === "selector" || node.type === "sequence")
        {
            for (const child of node.children)
            {
                this.number(child, index)
            }
        }
    }

    private run(node: Node<M, C>, monster: M, context: C): Status
    {
        switch (node.type)
        {
            case "condition":
                return node.test(monster, context) ? "success" : "failure"
            case "leaf":
            {
                const index = this.indices.get(node)!
                if (index !== monster.memory.running && node.start && !node.start(monster, context))
                {
                    return "failure"
                }
                const status = node.tick(monster, context)
                if (status === "running")
                {
                    this.active = index
                }
                return status
            }
            default:
            {
                const ends: Status = node.type === "selector" ? "failure" : "success"
                for (const child of node.children)
                {
                    const status = this.run(child, monster, context)
                    if (status !== ends)
                    {
                        return status
                    }
                }
                return ends
            }
        }
    }
}
