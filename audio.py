"""Synthesize the soundtrack from out/cues.json -> out/audio.wav (48 kHz stereo).

Music bed (pads, plucks, soft pulse) + SFX locked to the animation's cue times.
"""
import json
import pathlib
import wave

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"
SR = 48000
rng = np.random.default_rng(7)

cues = json.loads((OUT / "cues.json").read_text())
# optional real BGM: python audio.py --bgm out/bgm_full.wav --start 12
import sys
BGM = pathlib.Path(sys.argv[sys.argv.index("--bgm") + 1]) if "--bgm" in sys.argv else None
BGM_START = float(sys.argv[sys.argv.index("--start") + 1]) if "--start" in sys.argv else 0.0
DUR = float(cues["duration"])
N = int(DUR * SR)
music = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, start, sig, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N or i + len(sig) <= 0:
        return
    j0 = max(0, -i)
    sig = sig[j0:]
    i = max(0, i)
    n = min(len(sig), N - i)
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += sig[:n] * gain * l * 1.414
    buf[i:i + n, 1] += sig[:n] * gain * r * 1.414


def tt(d):
    return np.arange(int(d * SR)) / SR


# ---------------- music ----------------
def synth_music():
    CH = {
        "Dm9": [50, 57, 60, 64, 65],
        "Bb": [46, 53, 57, 62, 69],
        "F": [41, 48, 57, 60, 67],
        "C": [48, 55, 62, 64, 67],
    }
    BEAT = 60 / 112
    BAR8 = BEAT * 8
    sections = [(0.0, 6.2, "Dm9"), (6.2, 14.0, "Bb")]
    t = 14.0
    loop = ["F", "C", "Dm9", "Bb"]
    k = 0
    while t < 52.0:
        e = min(t + BAR8, 52.0)
        sections.append((t, e, loop[k % 4]))
        t = e
        k += 1
    sections.append((52.0, DUR, "F"))


    def pad_note(f, d, att=0.9, rel=1.4):
        x = tt(d + rel)
        sig_l = np.zeros_like(x)
        sig_r = np.zeros_like(x)
        for h in range(1, 7):
            a = 1 / h ** 1.6
            sig_l += a * np.sin(2 * np.pi * f * h * 1.0016 * x + h)
            sig_r += a * np.sin(2 * np.pi * f * h * 0.9984 * x + 2 * h)
        env = np.minimum(1, x / att)
        env *= np.where(x > d, np.exp(-(x - d) / (rel / 3)), 1)
        trem = 1 + 0.08 * np.sin(2 * np.pi * 0.23 * x)
        return sig_l * env * trem, sig_r * env * trem


    for s, e, name in sections:
        for m in CH[name]:
            g = 0.05 if m < 48 else 0.035
            sl, sr_ = pad_note(mtof(m), e - s)
            i = int(s * SR)
            n = min(len(sl), N - i)
            music[i:i + n, 0] += sl[:n] * g
            music[i:i + n, 1] += sr_[:n] * g


    def chord_at(t):
        for s, e, name in sections:
            if s <= t < e:
                return CH[name]
        return CH["F"]


    def pluck(f, d=0.5):
        x = tt(d)
        env = np.exp(-x / 0.16) * np.minimum(1, x / 0.004)
        return (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(4 * np.pi * f * x) + 0.12 * np.sin(6 * np.pi * f * x)) * env


    def kick():
        x = tt(0.35)
        f = 45 + 75 * np.exp(-x / 0.035)
        ph = 2 * np.pi * np.cumsum(f) / SR
        return np.sin(ph) * np.exp(-x / 0.12)


    def hat():
        x = tt(0.04)
        n = rng.standard_normal(len(x))
        n = np.diff(n, prepend=0)
        return n * np.exp(-x / 0.008)


    def tick():
        x = tt(0.03)
        return (np.sin(2 * np.pi * 2600 * x) * 0.6 + rng.standard_normal(len(x)) * 0.25) * np.exp(-x / 0.005)


    groove = [(19.6, 32.9, 1.0), (33.0, 42.8, 0.45), (43.6, 51.7, 1.0)]
    for gs, ge, lvl in groove:
        n8 = int((ge - gs) / (BEAT / 2))
        pat = [0, 2, 1, 3, 2, 4, 3, 1]
        for i in range(n8):
            t0 = gs + i * BEAT / 2
            ch = chord_at(t0)
            m = ch[pat[i % 8] % len(ch)] + 12
            vel = 0.9 if i % 2 == 0 else 0.6
            add(music, t0, pluck(mtof(m)), pan=0.35 * np.sin(i * 0.9), gain=0.05 * vel * lvl)
            if lvl > 0.9:
                if i % 2 == 0:
                    add(music, t0, kick(), gain=0.22)
                else:
                    add(music, t0, hat(), pan=0.2, gain=0.035)

    # clock ticks while the single cursor waits (scene 2)
    t0 = 6.9
    while t0 < 12.8:
        add(music, t0, tick(), gain=0.06)
        t0 += BEAT


# ---------------- sfx ----------------
PAN = {"c0": 0.0, "A": -0.45, "B": 0.0, "C": 0.45}
PITCH = {"c0": 1.0, "A": 1.0, "B": 1.26, "C": 1.498}  # F6, A6, C7 (F major)


def click(p=1.0, soft=False):
    x = tt(0.09)
    n = rng.standard_normal(len(x)) * np.exp(-x / 0.0025)
    blip = np.sin(2 * np.pi * 1396.9 * p * x) * np.exp(-x / 0.018)
    thock = np.sin(2 * np.pi * 260 * x) * np.exp(-x / 0.02)
    s = 0.5 * n + 0.6 * blip + 0.7 * thock
    return s * (0.5 if soft else 1.0)


def key():
    x = tt(0.03)
    n = rng.standard_normal(len(x))
    n = np.convolve(n, np.ones(5) / 5, mode="same")
    return n * np.exp(-x / 0.006) * rng.uniform(0.6, 1.0)


def bell(f, d=0.6, dec=0.22):
    x = tt(d)
    return (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * f * 2.76 * x) * np.exp(-x / 0.05)) * np.exp(-x / dec) * np.minimum(1, x / 0.002)


def whoosh(d=0.9):
    x = tt(d)
    n = rng.standard_normal(len(x))
    env = np.sin(np.pi * np.clip(x / d, 0, 1)) ** 2
    out = np.zeros_like(n)
    y = 0.0
    for i in range(len(n)):
        fc = 300 + 3200 * np.sin(np.pi * i / len(n)) ** 2
        a = 1 - np.exp(-2 * np.pi * fc / SR)
        y += a * (n[i] - y)
        out[i] = y
    return out * env * 3


def bloom():
    x = tt(2.2)
    low = np.sin(2 * np.pi * 110 * x) * np.minimum(1, x / 0.5) * np.exp(-x / 0.9)
    sh = sum(np.sin(2 * np.pi * mtof(m) * x) for m in (77, 81, 84, 89)) * np.exp(-x / 0.7) * 0.25
    return low * 0.8 + sh


def pop():
    x = tt(0.1)
    f = 700 + 500 * np.exp(-x / 0.02)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x / 0.03)


for c in cues["clicks"]:
    add(sfx, c["t"], click(PITCH[c["ch"]], c.get("release", False)), pan=PAN[c["ch"]], gain=0.42)
for t0 in cues["keys"]:
    add(sfx, t0, key(), pan=rng.uniform(-0.3, 0.3), gain=0.22)
for t0 in cues["whoosh"]:
    add(sfx, t0, whoosh(), gain=0.12)
for t0 in cues["dispatch"]:
    for j, m in enumerate((89, 93, 96)):
        add(sfx, t0 + j * 0.06, bell(mtof(m)), pan=(-0.45, 0, 0.45)[j], gain=0.2)
for t0 in cues["observe"]:
    for j, m in enumerate((96, 93, 89)):
        add(sfx, t0 + j * 0.05, bell(mtof(m), dec=0.12), pan=(0.45, 0, -0.45)[j], gain=0.1)
for t0 in cues["chime"]:
    add(sfx, t0, bell(mtof(89), 0.9, 0.35), gain=0.17)
    add(sfx, t0 + 0.09, bell(mtof(96), 0.9, 0.4), gain=0.17)
for t0 in cues["bloom"]:
    add(sfx, t0, bloom(), gain=0.22)
for t0 in cues["pop"]:
    add(sfx, t0, pop(), gain=0.12)

# ---------------- mix ----------------
if BGM:
    with wave.open(str(BGM)) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2
        w.setpos(int(BGM_START * SR))
        seg = np.frombuffer(w.readframes(N), np.int16).reshape(-1, 2) / 32768.0
    music[:len(seg)] = seg * 0.55
    print(f"BGM: {BGM.name} from {BGM_START:.1f}s")
else:
    synth_music()
x = np.arange(N) / SR
fin, fout = (0.15, 2.5) if BGM else (0.6, 1.2)
fade = np.clip(x / fin, 0, 1) * np.clip((DUR - x) / fout, 0, 1)
mix = (music * 0.9 + sfx) * fade[:, None]
mix = np.tanh(mix * 1.4) / 1.4
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix * 32767).astype(np.int16)
with wave.open(str(OUT / "audio.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", OUT / "audio.wav", f"{DUR:.1f}s")
