#!/usr/bin/env python3
"""Render every line through a neural TTS API.

This is the route that gets you the genuinely indistinguishable tier. Pick a
service, export its key, and run it:

    ELEVEN_KEY=... ELEVEN_VOICE=<voice id>  python3 voice/render-api.py eleven
    OPENAI_KEY=...  OPENAI_VOICE=onyx       python3 voice/render-api.py openai

Both write mono mp3s named after each line's id into voice/audio/, skipping
anything already rendered, so an interrupted run just picks up where it left
off. About 1,100 words in total.
"""
import json, os, sys, time, urllib.request

OUT = "voice/audio"
LINES = json.load(open("voice/lines.json"))

def post(url, headers, body):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

def eleven(text):
    key = os.environ["ELEVEN_KEY"]
    vid = os.environ.get("ELEVEN_VOICE", "onwK4e9ZLuTAKqWW03F9")   # a deep default
    return post(
        "https://api.elevenlabs.io/v1/text-to-speech/%s?output_format=mp3_22050_32" % vid,
        {"xi-api-key": key, "Content-Type": "application/json"},
        json.dumps({"text": text, "model_id": "eleven_multilingual_v2",
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.8,
                                       "style": 0.15}}).encode())

def openai(text):
    key = os.environ["OPENAI_KEY"]
    return post(
        "https://api.openai.com/v1/audio/speech",
        {"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        json.dumps({"model": "gpt-4o-mini-tts", "input": text,
                    "voice": os.environ.get("OPENAI_VOICE", "onyx"),
                    "instructions": "A dry, unhurried narrator. Deadpan, faintly amused, "
                                    "never hurried. He has already read the report.",
                    "response_format": "mp3"}).encode())

def main():
    which = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    render = {"eleven": eleven, "openai": openai}.get(which)
    if not render:
        print(__doc__); sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    for i, e in enumerate(LINES, 1):
        path = os.path.join(OUT, e["id"] + ".mp3")
        if os.path.exists(path) and os.path.getsize(path) > 500:
            continue
        for attempt in range(4):
            try:
                open(path, "wb").write(render(e["text"]))
                break
            except Exception as err:
                if attempt == 3:
                    print("  failed:", e["id"], err); break
                time.sleep(2 ** attempt)
        print("%3d/%d  %s  %s" % (i, len(LINES), e["id"], e["text"][:52]))
    print("\ndone ->", OUT)
    print("now run:  python3 voice/pack.py")

main()
