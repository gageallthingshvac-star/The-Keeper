# Smith Air Stick World: Season 1, "The Rookie's First Summer"

One story told in 10 shorts. Every episode is a complete job on its own: a problem, a mistake, a fix and a payoff. Watched in order, it's the rookie's first summer, from walking hazard to tech who earns his own thumbs-up.

The memory between episodes lives in `stickworld/continuity.py`. Episodes read their starting state from it, so the scars, badges and returning customers stay consistent.

## The cast

| Who | Look | Role |
| --- | --- | --- |
| **The Lead** (main character) | Plain head, warm resting smile, MILWACKO bag | Calm, competent, kind. He shakes his head at the rookie, then helps him up and patches him up. He never gloats. Signature: thumbs-up and wink to camera when the job is done. |
| **The Rookie** | Red cap | Eager and twitchy. Makes exactly **one big mistake per episode** and learns from it. A lesson, once learned, never fails again. Later episodes show him using it. |
| **The Sweaty Neighbor** | Hair tuft | The EP2 homeowner, who comes back as a repeat customer (EP6, EP8). The hole the rookie put in their ceiling in EP2 is still taped over. |
| **LEMONNOX** (running gag) | Rusty beige units with a yellow badge | Every failing unit on the street is a LEMONNOX. Every one hauled off earns a **LEMONNOX badge on the truck bed**, a trophy row that grows all season. |

## How each short works on its own

1. **Hook in the first second**: the problem on screen (smoke, sweat, a dead unit, water). The `EP n` tag pops in at the top left.
2. **Arrival**: the truck pulls up, its badge row showing the season so far, or the techs walk in.
3. **The job, with the rookie's one mistake** (the gag). The lead reacts, then helps; the lesson is shown, not said.
4. **The payoff**: the fix works, with something satisfying (cold air, heat, a click into place).
5. **The lead's thumbs-up and wink.** End.

## How the series remembers (rewards watching in order)

- **The rookie's scars carry over.** EP1's zap leaves soot burnt into his cap (`scorched_cap`), worn ever after. EP2's ceiling earns a plaster on his shin (`shin_bandage`). EP7 puts safety glasses on him for good.
- **The truck keeps score**: one LEMONNOX badge per lemon hauled off (`WorkTruck(..., trophies=C.trophies(ep))`).
- **Every episode includes one callback**: the rookie visibly applying an earlier lesson, sometimes overdoing it (EP3).
- **The finale mirrors the pilot**: EP10 is EP1's job done right, beat for beat.

## Episode guide

| EP | Title | Rookie's mistake (the gag) | Lesson | Callback | Rookie earns | Badge |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Package Unit Changeout | Grabs a live whip, gets zapped | Kill the power first | (the pilot) | scorched cap | +1 |
| 2 | Attic Air Handler Swap | Steps between the joists, leg through the ceiling beside the homeowner's face | Walk the joists | Wears the EP1 scorched cap | shin plaster | +1 |
| 3 | Furnace Closet | Terrified of power since EP1, he shuts off **every** breaker: the house goes dark mid-movie night | Lock out the right breaker; change the filter (it bursts into a dust cloud) | EP1 zap, overdone | | +1 |
| 4 | Crawlspace Duct Rescue | Walks the joists perfectly (EP2), then gets stuck in the crawlspace hatch, hips first | Seal the ducts (mastic) | EP2 joists | | |
| 5 | Rooftop Unit | Climbs the ladder perfectly, facing it, then realizes the tools are on the ground | One trip: bag on your back | EP2 ladder and haul rope | | +1 |
| 6 | Thermostat Wiring | The Sweaty Neighbor again (taped ceiling hole). He pulls all 8 low-voltage wires without labelling them: spaghetti | Label every wire | EP1's 8 conductors; the EP2 hole | | |
| 7 | Refrigerant Recovery | No safety glasses; the hose spits and frosts his face | Wear your PPE | | safety glasses (worn from now on) | +1 |
| 8 | Condensate Clog | His EP2 ceiling patch starts dripping: a clogged drain overflowing | Keep the drain clear | EP2 hole finally fixed for real | | |
| 9 | No Heat Emergency | The lead is out sick; the rookie runs the call. He almost grabs a live wire, stops, and checks the breaker | Every lesson at once | All of them | | +1 |
| 10 | The Last LEMONNOX | None. He does EP1's changeout right, beat for beat | Graduation | Mirror of EP1 | his own MILWACKO bag; gives his first thumbs-up and wink | +1 |

## Continuity tracker

| EP | Rookie starts with | Truck badges at start | Notes |
| --- | --- | --- | --- |
| 1 | — | 0 | Cap scorched on screen at the zap |
| 2 | scorched cap | (no truck) | The lead sticks a plaster on his shin after pulling him out |
| 3 | scorched cap, shin plaster | 2 | |
| 4 | scorched cap, shin plaster | 3 | |
| 5 | scorched cap, shin plaster | 3 | |
| 6 | scorched cap, shin plaster | 4 | Sweaty Neighbor's ceiling: the EP2 hole under duct tape |
| 7 | scorched cap, shin plaster | 4 | |
| 8 | + safety glasses | 5 | |
| 9 | + safety glasses | 5 | |
| 10 | + safety glasses | 6 | |

## Voiceover callback lines (optional, for Gage)

- EP2: "He's still wearing the cap from last week."
- EP3: "Last time he touched a live wire. This time he's not taking any chances..."
- EP4: "Joists only. He learned that one the hard way."
- EP6: "Remember the ceiling? They remember the ceiling."
- EP10: "Same job as day one. Different rookie."

## Rules for every new episode

- Read the episode's row above, then `continuity.rookie_marks(ep)` and `continuity.trophies(ep)` for the starting state.
- Set `EPISODE = n` on the scene class and call `self.episode_tag()` first in `construct()`.
- Exactly one rookie mistake, one lesson, one callback, one thumbs-up.
- When an episode earns a new mark, add it to the rig and to `DRAWN_MARKS` in continuity.py, show it being earned on screen, and add it to the tracker above.
