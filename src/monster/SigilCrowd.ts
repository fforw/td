import { Group } from "three"
import Sigil, { sigilColor } from "../render/sigil"
import type { SigilState } from "./sigils"


/**
 * Shows the sigils on the floor of a level
 */
export default class SigilCrowd
{
    readonly group = new Group()

    private readonly shown = new Map<SigilState, Sigil>()
    /** not in use right now */
    private readonly spare: Sigil[] = []

    update(sigils: readonly SigilState[]): void
    {
        const { shown, spare } = this
        for (const [state, sigil] of shown)
        {
            if (!sigils.includes(state))
            {
                sigil.group.visible = false
                shown.delete(state)
                spare.push(sigil)
            }
        }
        for (const state of sigils)
        {
            let sigil = shown.get(state)
            if (!sigil)
            {
                sigil = spare.pop()
                if (!sigil)
                {
                    sigil = new Sigil(sigilColor(state.hue))
                    this.group.add(sigil.group)
                }
                sigil.setColor(sigilColor(state.hue))
                sigil.place(state.x, state.z, state.radius)
                shown.set(state, sigil)
            }
            sigil.update(state.age, state.broken)
        }
    }
}
