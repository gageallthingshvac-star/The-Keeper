"""Series continuity for Smith Air Stick World, season 1 ("The Rookie's First Summer").

Every short stands on its own; watched in order they tell one story. This file is the memory between episodes:
what each episode starts with (the rookie's scars, the LEMONNOX badges on the truck) and what it adds. Episodes
read their starting state from here instead of hard-coding it, so a scar earned in EP1 shows up in EP2..EP10.
The full season plan is episodes/SERIES.md.

    from stickworld import continuity as C
    rookie = StickFigure(..., accessory="cap", name="rookie", marks=C.rookie_marks(2))
    truck = WorkTruck(..., trophies=C.trophies(3))
"""

SEASON = 1

# per episode: the job, the rookie's mistake, the lesson, the scar he earns, and whether a LEMONNOX gets hauled off
EPISODES = {
    1: dict(slug="package_unit", title="Package Unit Changeout", mistake="grabs a live whip", lesson="kill the power first",
            earns=("scorched_cap",), lemon=True),
    2: dict(slug="attic_air_handler", title="Attic Air Handler Swap", mistake="steps between the joists",
            lesson="walk the joists", earns=("shin_bandage",), lemon=True),
    3: dict(slug="furnace_closet", title="Furnace Closet", mistake="kills every breaker in the house (overdoing EP1)",
            lesson="lock out the right breaker; change the filter", earns=(), lemon=True),
    4: dict(slug="crawlspace_ducts", title="Crawlspace Duct Rescue", mistake="gets stuck in the crawlspace hatch",
            lesson="seal the ducts", earns=(), lemon=False),
    5: dict(slug="rooftop_unit", title="Rooftop Unit", mistake="climbs up perfectly (EP2) and leaves the tools at the bottom",
            lesson="one trip: bag on your back", earns=(), lemon=True),
    6: dict(slug="thermostat_wires", title="Thermostat Wiring", mistake="pulls eight wires without labelling them",
            lesson="label every wire", earns=(), lemon=False),
    7: dict(slug="refrigerant_recovery", title="Refrigerant Recovery", mistake="no safety glasses, frosted face",
            lesson="wear your PPE", earns=("safety_glasses",), lemon=True),
    8: dict(slug="drain_clog", title="Condensate Clog", mistake="none of his own: the EP2 ceiling patch leaks",
            lesson="keep the drain clear", earns=(), lemon=False),
    9: dict(slug="no_heat", title="No Heat Emergency", mistake="almost repeats EP1, catches himself",
            lesson="every lesson at once", earns=(), lemon=True),
    10: dict(slug="last_lemonnox", title="The Last LEMONNOX", mistake="none: he runs the EP1 job right",
             lesson="graduation: his own bag and his own thumbs-up", earns=("own_bag",), lemon=True),
}


def rookie_marks(ep):
    """The scars the rookie walks in with at the start of episode `ep` (earned in earlier episodes)."""
    marks = []
    for n in range(1, ep):
        marks += list(EPISODES[n]["earns"])
    return tuple(m for m in marks if m in DRAWN_MARKS)


def trophies(ep):
    """LEMONNOX badges already on the truck at the start of episode `ep` (one per lemon hauled off before it)."""
    return sum(1 for n in range(1, ep) if EPISODES[n]["lemon"])


def title(ep):
    return f"EP {ep}: {EPISODES[ep]['title']}"


DRAWN_MARKS = {"scorched_cap", "shin_bandage"}  # marks the rig can draw today (add the rest when their episode is built)
