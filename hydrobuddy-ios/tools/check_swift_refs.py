#!/usr/bin/env python3
"""A static sanity pass over the Swift sources: balanced delimiters, and every
`Type.member` reference resolves to something declared in the project.

Not a compiler. It catches typos and renames across files, which is the class
of error most likely to survive a careful read. Run:  python3 tools/check_swift_refs.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
files = sorted(ROOT.glob("HydroBuddy/*.swift")) + sorted(ROOT.glob("HydroBuddyTests/*.swift"))
problems = []

# --- delimiters -------------------------------------------------------------
for path in files:
    src = path.read_text()
    stripped = re.sub(r'"(?:\\.|[^"\\])*"', '""', src)          # string literals
    stripped = re.sub(r'//[^\n]*', '', stripped)                 # line comments
    stripped = re.sub(r'/\*.*?\*/', '', stripped, flags=re.S)    # block comments
    for open_c, close_c in (("{", "}"), ("(", ")"), ("[", "]")):
        if stripped.count(open_c) != stripped.count(close_c):
            problems.append(f"{path.name}: unbalanced {open_c}{close_c} "
                            f"({stripped.count(open_c)} vs {stripped.count(close_c)})")

# --- declared members per type ----------------------------------------------
# Tracks brace depth so members declared after a nested type still belong to
# the outer type.
members: dict[str, set[str]] = {}
types: set[str] = set()
type_re = re.compile(r'^\s*(?:@\w+\s+)*(?:public |private |internal |final )*'
                     r'(?:struct|class|enum|extension|protocol)\s+([A-Z]\w*)')
member_re = re.compile(r'^\s*(?:@\w+(?:\([^)]*\))?\s+)*'
                       r'(?:public |private |fileprivate |internal |static |nonisolated |final |lazy |override )*'
                       r'(?:func\s+(\w+)|(?:var|let)\s+(\w+)|case\s+(\w+))')

for path in files:
    stack: list[tuple[str, int]] = []   # (type name, brace depth at declaration)
    depth = 0
    for raw in path.read_text().split("\n"):
        line = re.sub(r'//.*$', '', raw)
        t = type_re.match(line)
        if t:
            name = t.group(1)
            types.add(name)
            members.setdefault(name, set())
            if stack:                      # nested type is also a member of its parent
                members[stack[-1][0]].add(name)
            depth += line.count("{") - line.count("}")
            stack.append((name, depth))
            continue

        if stack:
            m = member_re.match(line)
            if m:
                name = m.group(1) or m.group(2) or m.group(3)
                if name:
                    members[stack[-1][0]].add(name)
            c = re.match(r'^\s*case\s+([\w,\s]+)$', line)
            if c and "(" not in line:
                for name in c.group(1).split(","):
                    members[stack[-1][0]].add(name.strip())

        depth += line.count("{") - line.count("}")
        while stack and depth < stack[-1][1]:
            stack.pop()

# Types the project owns and whose static surface we can check.
OWNED = {"HydrationEngine", "CoachEngine", "NotificationManager", "ChaosChorus",
         "Haptics", "Palette", "Store", "AppState", "DrinkType", "Coach", "Technique",
         "DrinkEntry", "Profile", "PsychSettings", "Intent", "Vibe", "Units"}
ref_re = re.compile(r'\b(' + "|".join(sorted(OWNED)) + r')\.(\w+)')
ALLOW = {"all", "allCases", "self", "init", "Type", "currentSchema", "named",
         "make", "techniques", "cues", "message", "technique", "slots", "millilitresPerOunce"}
for path in files:
    for n, line in enumerate(path.read_text().split("\n"), 1):
        if line.strip().startswith("//"):
            continue
        for type_name, member in ref_re.findall(line):
            if member in ALLOW:
                continue
            known = members.get(type_name, set())
            if member not in known:
                problems.append(f"{path.name}:{n}: {type_name}.{member} is not declared on {type_name}")

# --- every technique id has a settings switch -------------------------------
engine_ids = set(re.findall(r'Technique\(id: "(\w+)"', (ROOT / "HydroBuddy/CoachEngine.swift").read_text()))
settings_ids = set(re.findall(r'"(\w+)": (?:true|false)', (ROOT / "HydroBuddy/Models.swift").read_text()))
if engine_ids != settings_ids:
    problems.append(f"technique ids {sorted(engine_ids)} != settings switches {sorted(settings_ids)}")

# --- generated content sanity ----------------------------------------------
content = (ROOT / "HydroBuddy/CoachContent.swift").read_text()
coach_count = content.count("Coach(\n")
if coach_count != 10:
    problems.append(f"expected 10 coaches in generated content, found {coach_count}")
for intent in ("welcome", "behind", "ontrack", "almost", "done", "over", "comeback"):
    if content.count(f".{intent}: [") != 10:
        problems.append(f"only {content.count(f'.{intent}: [')} coaches define .{intent} lines")

print(f"scanned {len(files)} Swift files, {len(types)} types, {sum(len(v) for v in members.values())} members")
if problems:
    print("\nPROBLEMS:")
    for p in problems: print(" -", p)
    sys.exit(1)
print("static reference check OK")
