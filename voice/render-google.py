#!/usr/bin/env python3
"""Render the lines with Google Cloud Text-to-Speech.

The key is read from the environment and never written to a file, never
logged and never committed.

    export GOOGLE_TTS_KEY=...

    python3 voice/render-google.py --list
        every English voice the key can reach, best tier first

    python3 voice/render-google.py --audition
        one line in each of the top candidates, into voice/audition/,
        so the voice gets picked by ear rather than by name

    python3 voice/render-google.py --voice en-GB-Chirp3-HD-Charon
        the whole set into voice/audio/, skipping anything already there
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error, base64

API = "https://texttospeech.googleapis.com/v1"
KEY = os.environ.get("GOOGLE_TTS_KEY", "")
# the tiers, best first: Chirp 3 HD and Studio are the ones that sound real
TIER = [("chirp3-hd", 400), ("chirp-hd", 380), ("studio", 340),
        ("neural2", 260), ("wavenet", 200), ("news", 180), ("polyglot", 170)]
LOWER = re.compile(r"-(B|D|J|Q|I|Charon|Fenrir|Orus|Puck|Enceladus|Iapetus|Algenib|Alnilam|Schedar|Rasalgethi|Achird|Zubenelgenubi|Sadaltager|Gacrux)$", re.I)

def call(path, body=None):
    if not KEY:
        sys.exit("set GOOGLE_TTS_KEY first")
    url = "%s/%s?key=%s" % (API, path, KEY)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:400]
        # never echo the key back, even inside an error
        sys.exit("HTTP %s from Google:\n%s" % (e.code, msg.replace(KEY, "<key>") if KEY else msg))

def score(v):
    n = v["name"].lower()
    s = 0
    for tag, pts in TIER:
        if tag in n: s = max(s, pts)
    if v.get("ssmlGender") == "MALE": s += 40
    elif v.get("ssmlGender") == "FEMALE": s -= 60
    elif LOWER.search(v["name"]): s += 30      # Chirp voices report no gender
    if v["name"].startswith("en-GB"): s += 14
    elif v["name"].startswith("en-US"): s += 8
    elif v["name"].startswith("en-AU"): s += 4
    return s

def english():
    vs = [v for v in call("voices")["voices"]
          if any(l.startswith("en-") for l in v["languageCodes"])]
    return sorted(vs, key=score, reverse=True)

def synth(text, name):
    lang = "-".join(name.split("-")[:2])
    body = {"input": {"text": text},
            "voice": {"languageCode": lang, "name": name},
            "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000,
                            "speakingRate": 0.96, "pitch": 0.0}}
    return base64.b64decode(call("text:synthesize", body)["audioContent"])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--audition", action="store_true")
    ap.add_argument("--voice")
    ap.add_argument("--line", default="One leg is sufficient. Two would be showing off.")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--out", default="voice/audio")
    a = ap.parse_args()

    if a.list or a.audition:
        vs = english()
        print("%d English voices, best tier first:\n" % len(vs))
        for v in vs[:a.top if a.audition else 40]:
            print("  %-34s %-8s %s" % (v["name"], v.get("ssmlGender", "-"), score(v)))
        if not a.audition:
            return
        os.makedirs("voice/audition", exist_ok=True)
        print("\nrendering one line in each of the top %d:" % a.top)
        for v in vs[:a.top]:
            p = "voice/audition/%s.mp3" % v["name"]
            open(p, "wb").write(synth(a.line, v["name"]))
            print("  ", p)
        print("\npick one, then: --voice <name>")
        return

    if not a.voice:
        print(__doc__); sys.exit(1)
    lines = json.load(open("voice/lines.json"))
    os.makedirs(a.out, exist_ok=True)
    done = 0
    for i, e in enumerate(lines, 1):
        p = os.path.join(a.out, e["id"] + ".mp3")
        if os.path.exists(p) and os.path.getsize(p) > 500:
            continue
        for attempt in range(4):
            try:
                open(p, "wb").write(synth(e["text"], a.voice)); done += 1; break
            except SystemExit:
                raise
            except Exception as err:
                if attempt == 3: print("  failed:", e["id"], err)
                else: time.sleep(2 ** attempt)
        print("%3d/%d  %s  %s" % (i, len(lines), e["id"], e["text"][:48]))
    print("\nrendered %d new clips -> %s\nnow run: python3 voice/pack.py" % (done, a.out))

main()
