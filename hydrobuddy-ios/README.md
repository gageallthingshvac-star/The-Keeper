# HydroBuddy+ — native iPhone app

A SwiftUI port of `../hydrobuddy.html`. Same estimate maths, same ten animal
coaches, same opt-in technique engine, same Feral vibe — plus the two things a
web page genuinely cannot do: Apple Health and notifications that fire while
the app is closed.

## Open and run

```
open HydroBuddy.xcodeproj      # Xcode 15 or newer
```

Select your team under **Signing & Capabilities** (the bundle id is
`com.hydrobuddy.app`; change it if it collides), pick a simulator or your
phone, then ⌘R to run and ⌘U to test.

**If signing fails on the HealthKit entitlement** (some free accounts cannot
provision it): delete `CODE_SIGN_ENTITLEMENTS` from the target's build
settings and remove the HealthKit capability. Everything except the Health
switch keeps working — `HealthKitManager` degrades to "not available" and
logging is unaffected.

## What has actually been verified

Be suspicious of any claim here that isn't in this table. There is no Xcode
and no Swift toolchain on the machine that generated this, so **none of the
Swift has been compiled or run.** What *was* done:

| Check | How | Result |
|---|---|---|
| Project file is well-formed | `python3 tools/check_pbxproj.py` parses `project.pbxproj` as an OpenStep plist and walks the object graph | 69 objects, no dangling refs, no orphans, every source in a Sources phase |
| Cross-file symbols resolve | `python3 tools/check_swift_refs.py` | 20 files, 65 types, 592 members, no unresolved `Type.member` |
| Coach content is faithful | generated from the web app by `tools/gen-content.mjs`, not retyped | 10 coaches × 7 intents = 223 lines, byte-for-byte |
| Engine matches the tested implementation | `tools/gen-vectors.mjs` runs the JS engine (which has browser test coverage) over 340 cases and writes `HydroBuddyTests/parity-vectors.json` | vectors generated; `ParityVectorTests` asserts the Swift engine reproduces them |

**Still on you:** ⌘U on a Mac. The first run is where compile errors and any
real parity drift will show up. Everything above narrows that risk; none of it
replaces the compiler.

## Layout

```
HydroBuddy/
  Models.swift             value types + persisted AppState
  CoachContent.swift       GENERATED — 10 coaches, chaos chorus, drink types
  HydrationEngine.swift    all the maths: estimate, totals, streaks, pace, intent (pure, testable)
  CoachEngine.swift        9 behaviour-change techniques + message assembly
  Store.swift              @MainActor state owner, debounced atomic persistence
  HealthKitManager.swift   authorization, write-on-log, delete-on-remove
  NotificationManager.swift waking-window schedule expanded into daily triggers
  Theme.swift              per-coach palette, Feral override, card chrome
  RingView.swift           progress ring + animated water level
  TodayView / CoachView / StatsView / SetupView
HydroBuddyTests/           parity, engine, coach, schedule, store tests
tools/                     generators and static checkers
```

## Design notes

**Persistence** is one `Codable` blob written atomically to Application
Support, debounced 400 ms, plus a synchronous save on backgrounding. Not
`UserDefaults`, and not a `didSet` on every property — dragging a slider
should not re-encode your whole drink history on every frame.

**Apple Health is wired to logging, not just to a settings button.** Each
logged drink is written as dietary water and the returned sample UUID is
stored on the entry, so deleting a drink here deletes the sample it wrote.
`requestAuthorization` succeeding only means the sheet appeared, so the real
`authorizationStatus(for:)` is re-read afterwards — otherwise a user who
tapped Don't Allow gets silent write failures.

**Reminders respect quiet hours.** iOS has no "every 90 minutes while awake"
trigger, so `NotificationManager.slots` expands your waking window into
individual daily calendar triggers, capped at 32 (the system limit is 64
pending). Nothing is scheduled in the last hour before bed.

**The coach engine takes an injected `RandomNumberGenerator`,** so message
selection is deterministic under test. Technique ids are asserted to match the
settings switches — a technique you cannot turn off is a bug.

## Regenerating

```
node tools/gen-content.mjs        # coaches/drinks from hydrobuddy.html
node tools/gen-vectors.mjs        # parity vectors from the JS engine
python3 tools/gen_xcodeproj.py    # project file (deterministic ids)
python3 tools/check_pbxproj.py    # validate the project graph
python3 tools/check_swift_refs.py # validate cross-file references
```

Change a coach line in `hydrobuddy.html`, re-run the first two, and the app and
its tests follow. Add a Swift file, re-run the third, and it is in the build.

## Not ported

The web app's confetti bursts, toast queue and scanline overlay. They are
browser-flavoured; the native app uses haptics and SwiftUI transitions instead.
Everything functional is here.

## The disclaimer, again

The target is an estimate from body size, activity, climate and life stage.
It is not medical advice. If you have kidney, heart or liver conditions, or
take medication affecting fluid balance, use your clinician's number.
