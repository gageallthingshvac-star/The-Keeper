# The recorded voice

The game speaks his cards in three tiers and falls down them on its own:

| tier | what it is | how real |
|---|---|---|
| **recorded** | a clip rendered in advance by a neural voice, packed into `VOICE_CLIPS` | indistinguishable |
| **spoken** | the device's own speech engine reads the card | very good on an enhanced voice, plainly a machine on a standard one |
| **horn** | a muted trombone with the shape of the sentence and none of its words | always available |

Only the first tier needs anything doing, because a neural voice is hundreds
of megabytes and a single-file game cannot carry one. Rendering it is three
commands.

## 1. Render

There are 139 lines, about 1,100 words, roughly seven minutes of speech.
Every route writes mono mp3s named after each line's id into `voice/audio/`,
skips anything already there, and can be interrupted and resumed.

**A Mac you already own** — free, and the Premium voices are the same engine
Apple ships in its own products:

```sh
# System Settings › Accessibility › Spoken Content › System Voice ›
# Manage Voices, and download an English voice marked Premium.
say -v '?' | grep en_            # find its exact installed name
brew install ffmpeg
VOICE="Daniel (Premium)" ./voice/render-macos.sh
```

**A neural API** — the tier that is genuinely indistinguishable:

```sh
ELEVEN_KEY=... ELEVEN_VOICE=<voice id>  python3 voice/render-api.py eleven
OPENAI_KEY=...  OPENAI_VOICE=onyx       python3 voice/render-api.py openai
```

The OpenAI route carries a direction with every line — *"a dry, unhurried
narrator, deadpan, faintly amused, never hurried; he has already read the
report"* — which is worth more than any voice setting.

## 2. Pack

```sh
python3 voice/pack.py
```

Reads `voice/audio/`, base64s each clip and rewrites the `VOICE_CLIPS` table
in `updraft.html`. Re-runnable: it replaces the whole table rather than
appending, so render more lines and run it again.

## 3. Weight

At 32 kbps mono the whole set is about 1.6 MB of audio, which lands as
roughly 2.2 MB of base64 and takes the game from 0.35 MB to about 2.5 MB.
That is a normal web page and it still opens instantly, but if it matters,
render a subset: the drop and reaction pools are the lines heard most, since
those are the ones said through the hatch with him on screen. `pack.py`
reports how many it found and how many are still missing.

## Adding or changing a line

`lines.json` keys each line by the first eight characters of the SHA-1 of its
text, so a filename never moves when the pools are reordered — but it does
change if the wording changes. Re-extract after editing the pools in
`updraft.html`, then render only what is new; `pack.py` skips nothing and
`render-*` skips everything already on disk.
