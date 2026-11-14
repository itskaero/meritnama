"""meritNAMA promo score: 30 s, 120 BPM, A minor. Synthesised from scratch (no samples).

Bars are 2 s. Sections: intro 0-4 (pad + riser), drop 4-12, section B 12-20 (adds lead stabs),
breakdown 20-24 (filtered, no kick, riser), final drop 24-28, closing hit 28 with a tail to 30.
Writes music.wav (44.1 kHz, 16-bit stereo) and beats.json (hit times the visuals key off).
"""
import json
import wave
import numpy as np

SR = 44100
DUR = 30.0
N = int(SR * DUR)
BPM = 120
BEAT = 60 / BPM          # 0.5 s
BAR = 4 * BEAT           # 2 s
rng = np.random.default_rng(7)   # fixed seed: the same track every run

L = np.zeros(N)
R = np.zeros(N)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def add(sig, start, gain=1.0, pan=0.0):
    """Mix a mono signal in at `start` seconds, equal-power pan in [-1, 1]."""
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    L[i:i + len(sig)] += sig * gain * np.cos(a)
    R[i:i + len(sig)] += sig * gain * np.sin(a)


def tt(d):
    return np.arange(int(d * SR)) / SR


def saw(f, d, harmonics_to=6000.0, detune=0.0):
    """Band-limited saw by additive synthesis; harmonics above `harmonics_to` Hz roll off (a soft low-pass)."""
    t = tt(d)
    out = np.zeros_like(t)
    f = f * (1 + detune)
    k = 1
    while k * f < min(harmonics_to * 2.5, SR / 2 - 200):
        roll = 1.0 / (1.0 + (k * f / harmonics_to) ** 4)
        out += np.sin(2 * np.pi * k * f * t + k * 0.7) * roll / k
        k += 1
    return out * 0.6


def adsr(d, a=0.005, dcy=0.1, s=0.6, r=0.1):
    n = int(d * SR)
    env = np.ones(n) * s
    na, nd, nr = int(a * SR), int(dcy * SR), int(r * SR)
    na = max(na, 1)
    env[:na] = np.linspace(0, 1, na)
    if nd > 0:
        env[na:na + nd] = np.linspace(1, s, len(env[na:na + nd]))
    if nr > 0 and nr < n:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


# ── Chords: Am9, Fmaj7, C(add9), G6 — one per bar ────────────────────────────
CHORDS = [
    [57, 60, 64, 67, 71],   # A C E G B
    [53, 57, 60, 64, 67],   # F A C E G
    [48, 55, 60, 62, 64],   # C G C D E
    [55, 59, 62, 64, 67],   # G B D E G
]
ROOTS = [45, 41, 48, 43]    # A2 F2 C3 G2


def chord_at(t):
    return int(t // BAR) % 4


# ── Sidechain pump keyed to the kick ─────────────────────────────────────────
kick_times = []
for b in range(int(DUR / BEAT)):
    t = b * BEAT
    if 4 <= t < 20 or 24 <= t < 28:
        kick_times.append(t)
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    seg = tt(0.4)
    duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.65 * np.exp(-seg / 0.09))

# Pad, bass and arp are built on their own buses so the pump and the breakdown filter apply to them.
padL, padR = np.zeros(N), np.zeros(N)
bassB = np.zeros(N)
arpL, arpR = np.zeros(N), np.zeros(N)


def bus_add(bl, br, sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    bl[i:i + len(sig)] += sig * gain * np.cos(a)
    if br is not None:
        br[i:i + len(sig)] += sig * gain * np.sin(a)


# ── Pad: detuned saws per chord, every bar until the closing hit ─────────────
for bar in range(14):
    t0 = bar * BAR
    notes = CHORDS[bar % 4]
    cutoff = 900 if t0 < 4 else (1500 if 20 <= t0 < 24 else 2600)
    for n in notes:
        for det, pan in ((-0.004, -0.7), (0.004, 0.7)):
            s = saw(midi(n), BAR + 0.25, harmonics_to=cutoff, detune=det) * adsr(BAR + 0.25, a=0.25 if t0 < 4 else 0.04, dcy=0.3, s=0.8, r=0.25)
            bus_add(padL, padR, s, t0, 0.055, pan)

# ── Bass: root eighths with an octave pop on the off-beat ────────────────────
for b in range(int(DUR / (BEAT / 2))):
    t = b * BEAT / 2
    if not (4 <= t < 20 or 22 <= t < 28):
        continue
    root = ROOTS[chord_at(t)]
    n = root + (12 if b % 2 else 0)
    d = BEAT / 2 * 0.92
    s = saw(midi(n), d, harmonics_to=700 if b % 2 == 0 else 1100) + 0.6 * np.sin(2 * np.pi * midi(root - 12) * tt(d))
    bus_add(bassB, None, s * adsr(d, a=0.003, dcy=0.08, s=0.7, r=0.03), t, 0.32)

# ── Arp: sixteenths over chord tones, up then down ───────────────────────────
pattern = [0, 1, 2, 3, 4, 3, 2, 1]
for b in range(int(DUR / (BEAT / 4))):
    t = b * BEAT / 4
    if not (4 <= t < 28):
        continue
    notes = CHORDS[chord_at(t)]
    n = notes[pattern[b % 8]] + 12
    d = BEAT / 4
    bright = 3200 if not (20 <= t < 24) else 1200 + 2200 * (t - 20) / 4
    s = saw(midi(n), d * 1.6, harmonics_to=bright) * adsr(d * 1.6, a=0.002, dcy=0.09, s=0.15, r=0.05)
    bus_add(arpL, arpR, s, t, 0.11, -0.45 if b % 2 else 0.45)

# Apply the pump (not during the breakdown: no kick there).
for bus in (padL, padR, bassB, arpL, arpR):
    bus *= duck
L += padL + bassB + arpL
R += padR + bassB + arpR

# ── Drums ────────────────────────────────────────────────────────────────────
def kick():
    t = tt(0.45)
    f = 45 + 110 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * 1.6)


def clap():
    t = tt(0.3)
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for off in (0, 0.011, 0.022):
        env += np.where(t >= off, np.exp(-(t - off) / 0.012), 0)
    env += np.exp(-t / 0.09) * 0.5
    # crude band-pass: difference of two smoothings
    hp = n - np.convolve(n, np.ones(6) / 6, mode="same")
    return hp * env * 0.9


def hat(open_=False):
    d = 0.22 if open_ else 0.05
    t = tt(d)
    n = rng.standard_normal(len(t))
    hp = n - np.convolve(n, np.ones(3) / 3, mode="same")
    return hp * np.exp(-t / (0.06 if open_ else 0.012))


K = kick()
for kt in kick_times:
    add(K, kt, 0.95)
for b in range(int(DUR / BEAT)):
    t = b * BEAT
    if (4 <= t < 20 or 24 <= t < 28) and b % 2 == 1:
        add(clap(), t, 0.42, 0.05)
for b in range(int(DUR / (BEAT / 2))):
    t = b * BEAT / 2
    if 2 <= t < 4 and b % 2 == 1:
        add(hat(), t, 0.10, 0.3)
    elif 4 <= t < 20 or 24 <= t < 28:
        add(hat(open_=(b % 2 == 1 and t >= 12)), t, 0.16 if b % 2 else 0.09, 0.35 if b % 2 else -0.25)

# Snare roll into the final drop (22-24 s), getting faster and louder.
roll_t = 22.0
step = BEAT / 2
while roll_t < 24:
    g = 0.12 + 0.3 * (roll_t - 22) / 2
    add(clap(), roll_t, g, 0.0)
    roll_t += step
    if roll_t > 23:
        step = BEAT / 4
    if roll_t > 23.5:
        step = BEAT / 8

# ── Lead stabs in section B (12-20) and the final drop (24-28) ───────────────
for bar_t in (12, 14, 16, 18, 24, 26):
    notes = CHORDS[chord_at(bar_t)]
    for off in (0, 0.75, 1.5):
        for n in notes[1:4]:
            s = saw(midi(n + 12), 0.22, harmonics_to=4500) * adsr(0.22, a=0.002, dcy=0.12, s=0.2, r=0.06)
            add(s, bar_t + off, 0.06, -0.2 if off == 0.75 else 0.2)

# ── Risers and impacts ───────────────────────────────────────────────────────
def riser(d, f0=300, f1=6000):
    t = tt(d)
    n = rng.standard_normal(len(t))
    out = np.zeros_like(t)
    # sweep a resonant-ish band by mixing smoothed noise with a rising sine
    f = f0 * (f1 / f0) ** (t / d)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    out = (n - np.convolve(n, np.ones(8) / 8, mode="same")) * 0.5 + tone
    return out * (t / d) ** 2


def impact():
    t = tt(2.5)
    f = 30 + 60 * np.exp(-t / 0.3)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    n = rng.standard_normal(len(t)) * np.exp(-t / 0.35) * 0.35
    smooth = np.convolve(n, np.ones(40) / 40, mode="same")
    return np.tanh((boom + smooth * 3) * 1.4)


add(riser(3.6), 0.4, 0.22)
add(riser(3.8, 200, 8000), 20.2, 0.26)
add(riser(1.8), 10.2, 0.08)
for hit in (4.0, 12.0, 24.0, 28.0):
    add(impact(), hit, 0.75 if hit in (4.0, 24.0) else 0.5)

# Closing chord at 28: wide, bright, held to the end.
for n in CHORDS[0] + [69, 76]:
    for det, pan in ((-0.006, -0.8), (0.006, 0.8)):
        s = saw(midi(n), 2.0, harmonics_to=3000, detune=det) * adsr(2.0, a=0.005, dcy=0.6, s=0.5, r=1.2)
        add(s, 28.0, 0.06, pan)

# Sub swell in the intro.
t = tt(4.0)
add(np.sin(2 * np.pi * midi(33) * t) * (t / 4) ** 1.5, 0.0, 0.35)

# ── Space: a short convolution reverb (decaying stereo noise) ────────────────
def reverb(x, seconds=1.6, mix=0.18, seed=1):
    r = np.random.default_rng(seed)
    t = tt(seconds)
    ir = r.standard_normal(len(t)) * np.exp(-t / (seconds / 5))
    ir[: int(0.012 * SR)] = 0
    n = len(x) + len(ir)
    size = 1 << (n - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    wet /= np.max(np.abs(wet)) + 1e-9
    return x + wet * mix * np.max(np.abs(x))


L = reverb(L, seed=1)
R = reverb(R, seed=2)

# ── Master: gentle glue, fade the tail, soft clip, normalise to -1 dBFS ──────
fade = np.ones(N)
fade[int(29.2 * SR):] = np.linspace(1, 0, N - int(29.2 * SR))
L, R = L * fade, R * fade
L, R = np.tanh(L * 1.3), np.tanh(R * 1.3)
peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
L, R = L / peak * 0.89, R / peak * 0.89

pcm = (np.stack([L, R], axis=1) * 32767).astype(np.int16)
with wave.open("assets/music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

json.dump({"bpm": BPM, "beat": BEAT, "bar": BAR, "drops": [4, 12, 24], "closing": 28, "breakdown": [20, 24]}, open("assets/beats.json", "w"))
print("music.wav written,", round(N / SR, 2), "s")
