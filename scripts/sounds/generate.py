"""
Synthesises grabfold's default page-turn sounds from scratch: no samples,
nothing licensed, every component built from noise and sine waves. They are
released under the same MIT licence as the rest of grabfold.

  sounds/page-turn-{1,2,3}.mp3   three takes of a page turning forward
  sounds/board-turn-{1,2}.mp3    two takes of a hard cover or board page
  sounds/takes.json              the instant each take lands, in seconds

Only the forward turn is rendered. Turning back is the same sound with its
stereo travel mirrored, which the player does at playback time, so there is
nothing to ship for it.

Each take is shaped against grabfold's own turn: a lift crackle, a swish of
air whose band rises as the sheet speeds up and falls as it slows, and a
short dry flap where it lands on the facing page. The instant of that flap is
written to takes.json so the player can start a take partway in and have the
landing fall exactly when the page is seen to land.

To change them: edit page_turn() below, or the seeds at the bottom, then

  python3 -m venv /tmp/sfx && /tmp/sfx/bin/pip install numpy scipy
  /tmp/sfx/bin/python scripts/sounds/generate.py
  node scripts/sounds/embed.mjs

It needs ffmpeg with libmp3lame on the PATH.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48_000
ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "sounds"
OUT.mkdir(parents=True, exist_ok=True)
WORK = Path(tempfile.mkdtemp(prefix="grabfold-sounds-"))


# ----------------------------------------------------------------- helpers

def secs(n):
    return np.arange(n) / SR


def svf_bandpass(x, fc, q):
    """Topology-preserving state-variable filter with a per-sample cutoff,
    so the band can sweep the way air does as a sheet swings over."""
    fc = np.broadcast_to(fc, x.shape)
    k = 1.0 / q
    ic1 = ic2 = 0.0
    out = np.empty_like(x)
    for n in range(len(x)):
        g = np.tan(np.pi * min(fc[n], SR * 0.45) / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[n] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[n] = v1
    return out


def butter(x, kind, freq, order=2):
    sos = signal.butter(order, freq, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def bell(t, start, peak, end):
    """A smooth hump: sin² up to the peak, sin² down to the end."""
    e = np.zeros_like(t)
    up = (t >= start) & (t < peak)
    down = (t >= peak) & (t < end)
    e[up] = np.sin(0.5 * np.pi * (t[up] - start) / (peak - start)) ** 2
    e[down] = np.cos(0.5 * np.pi * (t[down] - peak) / (end - peak)) ** 2
    return e


def pan(mono, position):
    """Equal-power pan; position -1 (left) … +1 (right), scalar or per sample."""
    angle = (np.asarray(position) + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1)


def room(stereo, length, decay, wet, rng, tone=6000):
    """A small synthetic reverb: decorrelated decaying noise per channel."""
    n = int(length * SR)
    t = secs(n)
    out = stereo.copy()
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / decay)
        ir = butter(ir, "lowpass", tone)
        ir[: int(0.004 * SR)] = 0  # pre-delay
        ir /= np.sqrt(np.sum(ir ** 2))
        out[:, ch] += wet * signal.fftconvolve(stereo[:, ch], ir)[: len(stereo)]
    return out


def finish(stereo, loudness_db, fade_out=0.06, ceiling_db=-3.0):
    """Trims rumble no small speaker can play anyway, fades the ends so
    nothing clicks, and sets the level by RMS rather than by peak — so takes
    of the same sound come out equally loud, whatever their loudest instant."""
    x = np.stack([butter(stereo[:, ch], "highpass", 70) for ch in range(2)], axis=1)
    fade = int(0.004 * SR)
    x[:fade] *= np.linspace(0, 1, fade)[:, None]
    out = int(fade_out * SR)
    x[-out:] *= (np.cos(np.linspace(0, np.pi, out)) * 0.5 + 0.5)[:, None]
    active = x[np.max(np.abs(x), axis=1) > np.max(np.abs(x)) * 0.02]
    x *= 10 ** (loudness_db / 20) / np.sqrt(np.mean(active ** 2))
    peak = np.max(np.abs(x))
    if peak > 10 ** (ceiling_db / 20):
        x *= 10 ** (ceiling_db / 20) / peak
    return x


def write(name, stereo):
    """A WAV master in a scratch folder, and the MP3 that ships."""
    wav = WORK / f"{name}.wav"
    wavfile.write(wav, SR, (stereo * 32767).astype(np.int16))
    mp3 = OUT / f"{name}.mp3"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav),
         "-codec:a", "libmp3lame", "-q:a", "4", str(mp3)],
        check=True,
    )
    print(f"{mp3.name:20s} {len(stereo) / SR:5.2f}s  {mp3.stat().st_size / 1024:5.1f} KB")


def grains(t, density, rng, lo, hi, length=(0.001, 0.004)):
    """Paper crackle: sparse, tiny bursts of bright noise, as often as the
    density curve (grains per second) says."""
    out = np.zeros_like(t)
    p = density / SR
    for n in np.flatnonzero(rng.random(len(t)) < p):
        g = int(rng.uniform(*length) * SR)
        burst = rng.standard_normal(g) * np.exp(-np.linspace(0, 5, g))
        end = min(len(t), n + g)
        out[n:end] += burst[: end - n] * rng.uniform(0.3, 1.0)
    return butter(out, "bandpass", [lo, hi])


# --------------------------------------------------------------- page turn

def page_turn(seed):
    rng = np.random.default_rng(seed)
    stretch = rng.uniform(0.95, 1.05)
    dur = 0.74 * stretch + 0.14  # room for the landing and its reverb to die
    t = secs(int(dur * SR))
    n = len(t)

    lift_end = 0.07 * stretch
    peak = rng.uniform(0.25, 0.30) * stretch
    land = rng.uniform(0.575, 0.61) * stretch

    # The swish: air pushed by the sheet. The band climbs as the page speeds
    # up through the middle of its arc and falls as it slows to land.
    top = rng.uniform(1900, 2500)
    fc = 750 + (top - 750) * bell(t, 0.02, peak, land + 0.02)
    swish = svf_bandpass(rng.standard_normal(n), fc, 0.75)
    # Paper is never smooth: a slow random wobble in the level.
    wobble = butter(rng.standard_normal(n), "lowpass", 28)
    wobble /= np.max(np.abs(wobble))
    swish *= bell(t, 0.03, peak, land) * (1 + 0.4 * wobble)
    air = butter(rng.standard_normal(n), "highpass", 5500) * bell(
        t, 0.05, peak, land - 0.05
    )
    swish = swish / np.max(np.abs(swish)) + 0.18 * air / np.max(np.abs(air))
    # Air has no bass: the broad band lets some through, and it reads as rumble.
    swish = butter(swish, "highpass", 180)

    # Crackle: dense as the sheet is bent up off the stack, sparse in flight,
    # a small flurry as it settles.
    density = (
        320 * bell(t, 0.0, 0.025, lift_end)
        + 45 * bell(t, lift_end, peak, land)
        + 170 * bell(t, land - 0.03, land, land + 0.07)
    )
    crackle = grains(t, density, rng, 2500, 9000)
    crackle /= max(np.max(np.abs(crackle)), 1e-9)

    # Landing: the sheet settling on the others. Paper on paper is a short,
    # dry flap in the low mids — not a thump. The first version put a 95 Hz
    # sine here and it came out louder than the whole swish.
    after = np.clip(t - land, 0, None)
    on = t >= land
    flap = butter(rng.standard_normal(n), "bandpass", [180, 900]) * np.exp(-after / 0.018)
    flap += 0.25 * np.sin(2 * np.pi * 140 * after) * np.exp(-after / 0.02)
    flap *= on
    flap /= np.max(np.abs(flap))
    tick = butter(rng.standard_normal(n), "highpass", 4000) * np.exp(-after / 0.006)
    tick *= on
    tick /= np.max(np.abs(tick))

    # Travel: the leaf starts on the right and ends on the left.
    progress = np.clip((t - 0.03) / (land - 0.03), 0, 1)
    travel = 0.55 - 1.1 * (0.5 - 0.5 * np.cos(np.pi * progress))

    mix = (
        pan(0.55 * swish, travel)
        + pan(0.30 * crackle, travel)
        + pan(0.24 * flap, -0.35)
        + pan(0.14 * tick, -0.5)
    )
    mix = room(mix, 0.3, 0.06, 0.16, rng)
    return finish(mix, -24, fade_out=0.08), land


# -------------------------------------------------------------- board turn

def board_turn(seed):
    """A hard cover, or a page of a board book, swung over on its hinge.

    Timed like a page — the same turn, the same landing — but a board is not
    paper. It does not rustle, so there is no crackle; it moves more air and
    more slowly, so the swish sits an octave lower; it starts with the small
    knock of the hinge taking the weight; and it lands with body, a short
    dull thock of card on the stack, where a page only flaps.
    """
    rng = np.random.default_rng(seed)
    stretch = rng.uniform(0.96, 1.04)
    dur = 0.74 * stretch + 0.16
    t = secs(int(dur * SR))
    n = len(t)

    peak = rng.uniform(0.24, 0.29) * stretch
    land = rng.uniform(0.575, 0.6) * stretch

    # The hinge taking the weight as the board lifts.
    knock = butter(rng.standard_normal(n), "bandpass", [220, 1100]) * np.exp(-t / 0.018)
    knock += 0.35 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.03)
    knock /= np.max(np.abs(knock))

    # Air pushed by a large, stiff surface: low, broad, no flutter to speak of.
    top = rng.uniform(820, 1050)
    fc = 300 + (top - 300) * bell(t, 0.02, peak, land + 0.02)
    swish = svf_bandpass(rng.standard_normal(n), fc, 0.7)
    wobble = butter(rng.standard_normal(n), "lowpass", 9)
    wobble /= np.max(np.abs(wobble))
    swish *= bell(t, 0.03, peak, land) * (1 + 0.15 * wobble)
    # A firm cut below the band: a low, broad band lets the sub-bass through,
    # and the first render rumbled underneath the whole swing.
    swish = butter(swish, "highpass", 200, order=4)
    swish /= np.max(np.abs(swish))

    # The landing: card on the stack. Some body, but damped fast, so it is a
    # thock and not a boom.
    after = np.clip(t - land, 0, None)
    on = t >= land
    thock = sum(
        a * np.sin(2 * np.pi * f * after) * np.exp(-after / d)
        for f, a, d in [(135, 1.0, 0.03), (410, 0.5, 0.014), (1150, 0.25, 0.006)]
    ) * on
    thock += butter(rng.standard_normal(n), "bandpass", [300, 2600]) * np.exp(-after / 0.006) * on * 0.5
    thock = butter(thock, "highpass", 70)
    thock /= np.max(np.abs(thock))

    progress = np.clip((t - 0.03) / (land - 0.03), 0, 1)
    travel = 0.5 - 1.0 * (0.5 - 0.5 * np.cos(np.pi * progress))

    mix = (
        pan(0.12 * knock, 0.45)
        + pan(0.5 * swish, travel)
        + pan(0.36 * thock, -0.3)
    )
    # Drier than a page: the room smeared the thock into a boom.
    mix = room(mix, 0.3, 0.06, 0.12, rng)
    return finish(mix, -24, fade_out=0.08), land


# ---------------------------------------------------------------- render

SEEDS = [11, 23, 37]

takes = []
for index, seed in enumerate(SEEDS, start=1):
    forward, land = page_turn(seed)
    write(f"page-turn-{index}", forward)
    takes.append({"file": f"page-turn-{index}.mp3", "landsAt": round(float(land), 4)})

BOARD_SEEDS = [51, 67]

boards = []
for index, seed in enumerate(BOARD_SEEDS, start=1):
    forward, land = board_turn(seed)
    write(f"board-turn-{index}", forward)
    boards.append({"file": f"board-turn-{index}.mp3", "landsAt": round(float(land), 4)})

(OUT / "takes.json").write_text(json.dumps({"takes": takes, "boards": boards}, indent=2) + "\n")
print("sounds/takes.json", [take["landsAt"] for take in takes], [board["landsAt"] for board in boards])
