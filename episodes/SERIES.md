# Smith Air Stick World: Season 1, "The Rookie's First Summer"

One story told in 10 shorts. Every episode is a complete job on its own: a problem, a mistake, a fix and a payoff. Watched in order, it's the rookie's first summer, from brand-new hire (price tag still on his cap) to tech who earns his own thumbs-up.

The memory between episodes lives in `stickworld/continuity.py`. Episodes read their starting state from it, so the scars, badges and returning customers stay consistent.

## The cast

| Who | Look | Role |
| --- | --- | --- |
| **The Lead** (main character) | Plain head, warm resting smile, MILWACKO bag | Calm, competent, kind. He shakes his head at the rookie, then helps him up and patches him up. He never gloats. Signature: thumbs-up and wink to camera when the job is done. |
| **The Rookie** | Red cap | Eager and twitchy. Makes exactly **one big mistake per episode** and learns from it. A lesson, once learned, never fails again. Later episodes show him using it, sometimes overdoing it. |
| **The Sweaty Neighbor** | Hair tuft | The EP2 homeowner, who comes back as a repeat customer (EP6, EP8). The hole the rookie put in their ceiling in EP2 is still taped over. |
| **The Movie-Night Neighbor** | Hair bun | The EP3 customer, sweating through movie night on the couch. Their lights went out because of the rookie. |
| **LEMONNOX** (running gag) | Rusty beige units with a yellow badge | Every failing unit on the street is a LEMONNOX. Every one hauled off earns a **LEMONNOX badge on the truck bed**, a trophy row that grows all season. The rookie pocketed the very first badge in EP1. |

## How each short works on its own

1. **Hook in the first second**: the problem already happening on screen, in motion (smoke, sweat, a dead unit, water), framed close. The `EP n` tag pops in at the top left.
2. **Arrival, fast** (under ~3 s of travel): the truck pulls up, its badge row showing the season so far, or the techs walk in.
3. **The job, with the rookie's one mistake** (the gag), the cause found on screen before the fix. The lead reacts, then helps; the lesson is shown, not said. Small frustrations and small satisfactions alternate.
4. **The payoff**: the fix works, with something satisfying (cold air, a room going from hot orange to cool blue, a click into place), in the same framing as the hook so a replay reads as after -> before.
5. **The lead's thumbs-up and wink, then the rookie's attempt at his own**, which goes wrong (the running gag below). End.

Retention rules for every episode: skill section 9e.

## How the series remembers (rewards watching in order)

- **The rookie's scars carry over.** In EP1 his cap is brand new, price tag still swinging (`cap_tag`); the zap burns the tag off and leaves soot on the cap (`scorched_cap`), worn ever after. EP2's ceiling earns a plaster on his shin (`shin_bandage`). EP7 puts safety glasses on him for good.
- **The truck keeps score**: one LEMONNOX badge per lemon hauled off (`WorkTruck(..., trophies=C.trophies(ep))`). Only jobs that haul a LEMONNOX add one.
- **Every episode includes one callback**: the rookie visibly applying an earlier lesson (EP2: he kills the power first, EP1's lesson), sometimes overdoing it (EP3: he kills *all* the power).
- **The finale mirrors the pilot**: EP10 is EP1's job done right, beat for beat.
- **The season question: will the rookie earn his own thumbs-up?** Every episode ends with the rookie trying to copy the lead's thumbs-up, and it goes wrong in a way born from that episode: EP1 a leftover static spark off his thumb, EP2 a last chunk of insulation dropping out of his ceiling hole onto his head, EP3 a puff of filter dust. It escalates through the season (later: a glove stuck on, a gauge hose in the way, the lead out sick in EP9 so nobody to copy) until EP10, where he lands it, wink and all.

## Episode guide

| EP | Title | Rookie's mistake (the gag) | Lesson | Callback | Rookie earns | Badge |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Package Unit Changeout | Grabs a live whip, gets zapped (the price tag on his new cap burns off) | Kill the power first | (the pilot) | scorched cap; pockets the first LEMONNOX badge | +1 |
| 2 | Attic Air Handler Swap | Steps between the joists, leg through the ceiling beside the homeowner's face | Walk the joists | Proudly kills the disconnect before touching anything (EP1) | shin plaster | +1 |
| 3 | Movie Night | The coil is frozen solid (the lead snaps an icicle off it) and he's asked to shut that unit off. Terrified of power since EP1, he flips off **every** breaker: the house goes pitch black mid-movie | Lock out only the right breaker; a filthy filter freezes the coil (it bursts into a dust cloud) | Touches his scorched cap, then overdoes the EP1 lesson | | |
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
| 1 | price tag on his new cap | 0 | Tag burns off and the cap scorches at the zap; he pockets the LEMONNOX badge from the wreck |
| 2 | scorched cap | (no truck) | The lead sticks a plaster on his shin after pulling him out |
| 3 | scorched cap, shin plaster | 2 | Furnace repair, nothing hauled off. Filter dust on his face is temporary (dusted off at the end) |
| 4 | scorched cap, shin plaster | 2 | |
| 5 | scorched cap, shin plaster | 2 | |
| 6 | scorched cap, shin plaster | 3 | Sweaty Neighbor's ceiling: the EP2 hole under duct tape |
| 7 | scorched cap, shin plaster | 3 | |
| 8 | + safety glasses | 4 | |
| 9 | + safety glasses | 4 | |
| 10 | + safety glasses | 5 | |

## Voiceover callback lines (optional, for Gage)

- EP1: "Day one. Price tag's still on the hat."
- EP2: "He's still wearing the cap from last week. And he learned: power off first."
- EP3: "Last time he touched a live wire. This time he's not taking any chances..."
- EP4: "Joists only. He learned that one the hard way."
- EP6: "Remember the ceiling? They remember the ceiling."
- EP10: "Same job as day one. Different rookie."

## Rules for every new episode

- Read the episode's row above, then `continuity.rookie_marks(ep)` and `continuity.trophies(ep)` for the starting state.
- Set `EPISODE = n` on the scene class and call `self.episode_tag()` first in `construct()`.
- Exactly one rookie mistake, one lesson, one callback, one thumbs-up.
- When an episode earns a new mark, add it to the rig and to `DRAWN_MARKS` in continuity.py, show it being earned on screen, and add it to the tracker above.
