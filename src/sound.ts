import type { TurnEvent, TurnSound } from "./book.ts";
import { arrivalTime } from "./model.ts";

/**
 * Page-turn sounds, through Web Audio.
 *
 * A separate entry point, `grabfold/sound`, so the core never carries any of
 * this. Pass what `createPageTurnSound` returns as the book's `sound` option:
 *
 * ```ts
 * import { createPageTurnSound } from "grabfold/sound";
 * import { defaultBoardTurnTakes, defaultPageTurnTakes } from "grabfold/sounds";
 *
 * const sound = createPageTurnSound({
 *   takes: defaultPageTurnTakes,
 *   boardTakes: defaultBoardTurnTakes, // for hard covers and board pages
 * });
 * new Grabfold(element, { sheets: 12, render, sound });
 * ```
 *
 * Why Web Audio and not `<audio>`: an audio element fetches and decodes when
 * told to play, which lands a beat late on a page turn, and it cannot start
 * partway into a file with the precision the turn needs. Here every take is
 * decoded once, up front, and a play is a buffer handed to the speakers.
 */

/** One recorded sound. */
export interface SoundTake {
  /** A URL (a `data:` URI is fine), the file's bytes, or an already decoded buffer. */
  src: string | ArrayBuffer | AudioBuffer;
  /**
   * Seconds into the sound at which the page lands. With it, the sound is
   * started partway in so that its landing falls when the page is seen to
   * land; without it, the sound simply plays from the start.
   */
  landsAt?: number;
}

export interface PageTurnSoundOptions {
  /** The sounds of a page turning forward. One is picked per turn, never the same twice running. */
  takes: readonly SoundTake[];
  /**
   * Sounds for turning back. Leave out to use `takes` mirrored left to right
   * (see `mirrorBack`), which is what a page moving the other way sounds like.
   */
  backTakes?: readonly SoundTake[];
  /**
   * Sounds for a rigid leaf — a hard cover, or a page of a board book.
   * Leave out and rigid leaves use `takes` like any other.
   */
  boardTakes?: readonly SoundTake[];
  /** Turning back plays the forward takes with their stereo swapped. Default true. */
  mirrorBack?: boolean;
  /** 0 to 1. Default 0.7. */
  volume?: number;
  /** Start silent. Default false. */
  muted?: boolean;
  /** Time each take so its landing falls on the page's. Default true. */
  sync?: boolean;
  /**
   * Nudges the pitch of every play by up to this much either way — 0.03 is
   * 3% — so a run of turns does not sound like one recording on repeat.
   * Default 0.03; 0 for none.
   */
  pitchVariation?: number;
  /** Which turns are heard. Default all: drag, api and keyboard. */
  sources?: ReadonlyArray<TurnEvent["source"]>;
  /**
   * An AudioContext of your own, to share with the rest of the page's audio.
   * By default one is made the first time it is needed.
   */
  context?: AudioContext;
  /** Randomness, for tests. Default Math.random. */
  random?: () => number;
}

export interface PageTurnSound extends TurnSound {
  /** Fetches and decodes every take now, so the first turn is not late. */
  preload(): Promise<void>;
  volume: number;
  muted: boolean;
  /** Stops listening for the first gesture, and closes the context if it made one. */
  dispose(): void;
}

/* ------------------------------------------------------------------ timing */

/**
 * How far into a take to start it, in seconds.
 *
 * The take lands at `landsAt`; the page lands `arrivalTime(remaining)` from
 * now. Playing at `rate`, the take covers `rate` seconds of itself per second
 * of real time, so it has to start that much further back. A turn with all
 * its travel ahead gets most of the sound; a drag let go near the end gets
 * little more than the landing; an instant turn gets only the landing.
 */
export function startOffset(landsAt: number | undefined, remainingMs: number, rate = 1): number {
  if (landsAt === undefined) return 0;
  return Math.max(0, landsAt - (arrivalTime(Math.max(0, remainingMs)) / 1000) * rate);
}

/**
 * Which take to play next, 0-based. Never the one just played: the same
 * sound twice running is what makes a sound effect sound like one.
 */
export function nextTake(
  previous: number | null,
  count: number,
  random: () => number = Math.random,
): number {
  if (count <= 1) return 0;
  if (previous === null || previous < 0 || previous >= count) {
    return Math.floor(random() * count);
  }
  // Pick among the others and step over the last, so each stays equally likely.
  const pick = Math.floor(random() * (count - 1));
  return pick >= previous ? pick + 1 : pick;
}

/** A `data:` URI's bytes, read without fetch so no connect-src policy is needed. */
export function dataUriBytes(uri: string): ArrayBuffer | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  const body = match[2];
  if (!match[1]) return new TextEncoder().encode(decodeURIComponent(body)).buffer as ArrayBuffer;
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/* ------------------------------------------------------------------ player */

/** A very short fade in, so a take started partway through never clicks on. */
const FADE_IN = 0.012;

export function createPageTurnSound(options: PageTurnSoundOptions): PageTurnSound {
  const random = options.random ?? Math.random;
  const mirrorBack = options.mirrorBack ?? true;
  const sync = options.sync ?? true;
  const pitchVariation = Math.max(0, options.pitchVariation ?? 0.03);
  const sources = new Set(options.sources ?? ["drag", "api", "keyboard"]);
  let volume = clampVolume(options.volume ?? 0.7);
  let muted = options.muted ?? false;

  const hasWindow = typeof window !== "undefined";
  let context: AudioContext | null = options.context ?? null;
  const ownContext = !options.context;
  let decoder: BaseAudioContext | null = null;
  const buffers = new Map<SoundTake, Promise<AudioBuffer | null>>();
  // The last take played, per set and direction, so none repeats back to back.
  const last = new Map<string, number>();

  function live(): AudioContext | null {
    if (context) return context;
    if (!hasWindow) return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  }

  /**
   * A context to decode on before anyone has touched the page. A live one made
   * then would start suspended and have the browser complain; an offline one
   * never plays, so it is allowed any time, and what it decodes plays just as
   * well on the live one later.
   */
  function decoding(): BaseAudioContext | null {
    if (context) return context;
    if (decoder) return decoder;
    if (hasWindow && typeof OfflineAudioContext !== "undefined") {
      decoder = new OfflineAudioContext(2, 1, 48_000);
      return decoder;
    }
    return live();
  }

  function load(take: SoundTake): Promise<AudioBuffer | null> {
    let pending = buffers.get(take);
    if (pending) return pending;
    pending = (async () => {
      const src = take.src;
      if (typeof AudioBuffer !== "undefined" && src instanceof AudioBuffer) return src;
      let bytes: ArrayBuffer | null;
      if (typeof src === "string") {
        bytes = src.startsWith("data:")
          ? dataUriBytes(src)
          : await fetch(src).then((response) => {
              if (!response.ok) throw new Error(String(response.status));
              return response.arrayBuffer();
            });
      } else {
        // decodeAudioData takes the bytes over, so it is given a copy and the
        // caller's buffer stays usable.
        bytes = (src as ArrayBuffer).slice(0);
      }
      const ctx = decoding();
      return bytes && ctx ? await ctx.decodeAudioData(bytes) : null;
    })().catch(() => null); // A sound that will not load is silence, never an error.
    buffers.set(take, pending);
    return pending;
  }

  /**
   * Lets the browser play from the first touch onwards. Safari only lets a
   * context start from inside a gesture, and a dragged page is heard on
   * release, after the gesture that began it; waking the context on the
   * first press means every sound after that finds it running.
   */
  const wake = () => {
    const ctx = live();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    if (ctx?.state === "running") unlisten();
  };
  const gestures = ["pointerdown", "keydown", "touchend"] as const;
  let listening = false;
  function listen() {
    if (!hasWindow || listening || context?.state === "running") return;
    listening = true;
    for (const type of gestures) window.addEventListener(type, wake, true);
  }
  function unlisten() {
    if (!hasWindow || !listening) return;
    listening = false;
    for (const type of gestures) window.removeEventListener(type, wake, true);
  }
  listen();

  function play(event: TurnEvent): void {
    // A player used again after dispose() — React's strict mode does exactly
    // that — picks itself back up rather than staying deaf on Safari.
    listen();
    if (muted || !sources.has(event.source)) return;
    const back = event.direction === "prev";
    const board = event.hard && options.boardTakes && options.boardTakes.length > 0;
    // A board has its own sounds and is mirrored going back; paper may have
    // its own sounds for going back instead.
    const own = !board && back && options.backTakes && options.backTakes.length > 0;
    const set = board ? options.boardTakes! : own ? options.backTakes! : options.takes;
    if (set.length === 0) return;
    const mirror = back && !own && mirrorBack;

    const key = `${board ? "board" : "page"}:${event.direction}`;
    const index = nextTake(last.get(key) ?? null, set.length, random);
    last.set(key, index);
    const take = set[index];
    const rate = 1 + (random() * 2 - 1) * pitchVariation;

    const ctx = live();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const asked = performance.now();

    void load(take).then((buffer) => {
      if (!buffer || muted) return;
      // Anything spent waiting for a first load comes off the turn's time.
      const remaining = event.duration - (performance.now() - asked);
      const offset = sync ? startOffset(take.landsAt, remaining, rate) : 0;
      if (offset >= buffer.duration) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + FADE_IN);

      if (mirror && buffer.numberOfChannels === 2) {
        // The page travels the other way, so the stereo does too.
        const split = ctx.createChannelSplitter(2);
        const merge = ctx.createChannelMerger(2);
        source.connect(split);
        split.connect(merge, 0, 1);
        split.connect(merge, 1, 0);
        merge.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(ctx.destination);
      source.start(now, offset);
    });
  }

  return {
    play,
    async preload() {
      listen();
      const all = [...options.takes, ...(options.backTakes ?? []), ...(options.boardTakes ?? [])];
      await Promise.all(all.map(load));
    },
    get volume() {
      return volume;
    },
    set volume(value: number) {
      volume = clampVolume(value);
    },
    get muted() {
      return muted;
    },
    set muted(value: boolean) {
      muted = value;
    },
    dispose() {
      unlisten();
      if (ownContext && context) void context.close();
      context = null;
      decoder = null;
      buffers.clear();
    },
  };
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7;
}
