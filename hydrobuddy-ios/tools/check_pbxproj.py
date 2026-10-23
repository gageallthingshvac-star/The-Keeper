#!/usr/bin/env python3
"""Parses project.pbxproj as an OpenStep plist and checks its object graph.

Xcode refuses to open a project whose plist is malformed or whose references
dangle, and there is no Xcode on this machine, so this is the substitute:
a real parse plus referential-integrity checks. Run:
    python3 tools/check_pbxproj.py
"""
import pathlib, re, sys

SRC = pathlib.Path(__file__).resolve().parent.parent / "HydroBuddy.xcodeproj" / "project.pbxproj"
text = SRC.read_text()

class Parser:
    def __init__(self, s):
        self.s, self.i = s, 0

    def error(self, msg):
        line = self.s.count("\n", 0, self.i) + 1
        raise SystemExit(f"parse error at line {line}: {msg}")

    def skip(self):
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in " \t\n\r":
                self.i += 1
            elif self.s.startswith("//", self.i):
                self.i = self.s.find("\n", self.i) + 1 or len(self.s)
            elif self.s.startswith("/*", self.i):
                end = self.s.find("*/", self.i)
                if end < 0: self.error("unterminated comment")
                self.i = end + 2
            else:
                return

    def value(self):
        self.skip()
        c = self.s[self.i]
        if c == "{": return self.dict()
        if c == "(": return self.array()
        if c == '"': return self.quoted()
        return self.bare()

    def dict(self):
        self.i += 1
        out = {}
        while True:
            self.skip()
            if self.i >= len(self.s): self.error("unterminated dict")
            if self.s[self.i] == "}":
                self.i += 1
                return out
            key = self.value()
            self.skip()
            if self.s[self.i] != "=": self.error(f"expected = after key {key!r}")
            self.i += 1
            out[key] = self.value()
            self.skip()
            if self.s[self.i] == ";":
                self.i += 1
            else:
                self.error(f"expected ; after value of {key!r}")

    def array(self):
        self.i += 1
        out = []
        while True:
            self.skip()
            if self.i >= len(self.s): self.error("unterminated array")
            if self.s[self.i] == ")":
                self.i += 1
                return out
            out.append(self.value())
            self.skip()
            if self.s[self.i] == ",":
                self.i += 1

    def quoted(self):
        self.i += 1
        buf = []
        while True:
            c = self.s[self.i]
            if c == "\\":
                buf.append(self.s[self.i:self.i + 2]); self.i += 2
            elif c == '"':
                self.i += 1
                return "".join(buf)
            else:
                buf.append(c); self.i += 1

    def bare(self):
        start = self.i
        while self.i < len(self.s) and self.s[self.i] not in " \t\n\r=;,(){}\"":
            self.i += 1
        if start == self.i: self.error(f"unexpected character {self.s[self.i]!r}")
        return self.s[start:self.i]

if not text.startswith("// !$*UTF8*$!"):
    raise SystemExit("missing the UTF8 header comment Xcode writes")

root = Parser(text).value()
objects = root["objects"]
problems = []

# 1. Every 24-hex reference resolves to a defined object.
ID = re.compile(r"^[0-9A-F]{24}$")
def walk(node, path):
    if isinstance(node, dict):
        for k, v in node.items():
            walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for n, v in enumerate(node):
            walk(v, f"{path}[{n}]")
    elif isinstance(node, str) and ID.match(node) and node not in objects:
        problems.append(f"dangling reference {node} at {path}")
for oid, obj in objects.items():
    walk(obj, objects[oid].get("isa", "?") + " " + oid)
walk(root.get("rootObject"), "rootObject")

# 2. Everything defined is reachable from the root object.
reachable, stack = set(), [root["rootObject"]]
while stack:
    oid = stack.pop()
    if oid in reachable or oid not in objects:
        continue
    reachable.add(oid)
    def collect(node):
        if isinstance(node, dict):
            for v in node.values(): collect(v)
        elif isinstance(node, list):
            for v in node: collect(v)
        elif isinstance(node, str) and ID.match(node):
            stack.append(node)
    collect(objects[oid])
for oid in objects:
    if oid not in reachable:
        problems.append(f"orphan object {oid} ({objects[oid].get('isa')})")

# 3. Structural expectations.
def of(isa):
    return {k: v for k, v in objects.items() if v.get("isa") == isa}

targets = of("PBXNativeTarget")
if len(targets) != 2:
    problems.append(f"expected 2 targets, found {len(targets)}")
for oid, target in targets.items():
    for phase in target["buildPhases"]:
        if phase not in objects:
            problems.append(f"{target['name']} references missing build phase {phase}")
    if target["productReference"] not in objects:
        problems.append(f"{target['name']} has no product reference")
    configs = objects[target["buildConfigurationList"]]["buildConfigurations"]
    names = sorted(objects[c]["name"] for c in configs)
    if names != ["Debug", "Release"]:
        problems.append(f"{target['name']} configurations are {names}")

for oid, bf in of("PBXBuildFile").items():
    if bf.get("fileRef") not in objects:
        problems.append(f"build file {oid} has no file reference")

# 4. Every Swift file on disk is compiled by exactly one target.
root_dir = SRC.parent.parent
refs = of("PBXFileReference")
compiled = set()
for oid, phase in of("PBXSourcesBuildPhase").items():
    for bf in phase["files"]:
        compiled.add(refs[objects[bf]["fileRef"]]["path"])
on_disk = {p.name for p in (root_dir / "HydroBuddy").glob("*.swift")} | \
          {p.name for p in (root_dir / "HydroBuddyTests").glob("*.swift")}
for missing in sorted(on_disk - compiled):
    problems.append(f"{missing} exists on disk but is in no Sources phase")
for ghost in sorted(compiled - on_disk):
    problems.append(f"{ghost} is compiled but missing from disk")

# 5. Test resources are bundled.
bundled = set()
for oid, phase in of("PBXResourcesBuildPhase").items():
    for bf in phase["files"]:
        bundled.add(refs[objects[bf]["fileRef"]]["path"])
if "parity-vectors.json" not in bundled:
    problems.append("parity-vectors.json is not in a Resources phase; the parity tests cannot load it")

# 6. Settings that decide whether the thing runs at all.
app_cfg = [v for v in of("XCBuildConfiguration").values()
           if "PRODUCT_BUNDLE_IDENTIFIER" in v.get("buildSettings", {})
           and not v["buildSettings"]["PRODUCT_BUNDLE_IDENTIFIER"].endswith(".tests")]
for cfg in app_cfg:
    s = cfg["buildSettings"]
    if "CODE_SIGN_ENTITLEMENTS" not in s:
        problems.append("app target has no entitlements file (HealthKit will fail)")
    elif not (root_dir / s["CODE_SIGN_ENTITLEMENTS"]).exists():
        problems.append(f"entitlements file {s['CODE_SIGN_ENTITLEMENTS']} does not exist")
    for key in ("INFOPLIST_KEY_NSHealthShareUsageDescription", "INFOPLIST_KEY_NSHealthUpdateUsageDescription"):
        if key not in s:
            problems.append(f"missing {key}; HealthKit authorization crashes without it")

print(f"parsed {len(objects)} objects, {len(compiled)} compiled sources, {len(bundled)} bundled resources")
if problems:
    print("\nPROBLEMS:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("project graph OK")
