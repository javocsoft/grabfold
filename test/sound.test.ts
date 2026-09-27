import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalTime } from "../src/model.ts";
import { dataUriBytes, nextTake, startOffset } from "../src/sound.ts";
import { defaultBoardTurnTakes, defaultPageTurnTakes } from "../src/sounds.ts";

/** A deterministic stand-in for Math.random. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

const close = (actual: number, expected: number, why: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${why}: expected ${expected}, got ${actual}`);

test("a full turn starts the take so its landing meets the page's", () => {
  const landsAt = 0.58;
  const offset = startOffset(landsAt, 680);
  // Heard from `offset`, the take reaches its landing exactly when the page does.
  close(landsAt - offset, arrivalTime(680) / 1000, "landing lines up");
  assert.ok(offset > 0 && offset < landsAt);
});

test("a drag let go near the end skips further in", () => {
  assert.ok(startOffset(0.58, 150) > startOffset(0.58, 680));
});

test("an instant turn plays only the landing", () => {
  assert.equal(startOffset(0.58, 0), 0.58);
});

test("a turn longer than the take never asks for a negative start", () => {
  assert.equal(startOffset(0.58, 10_000), 0);
});

test("a take with no landing plays from the start", () => {
  assert.equal(startOffset(undefined, 680), 0);
});

test("a faster play covers more of the take in the same time", () => {
  // At 1.03x the take must start that much further back to land on time.
  const rate = 1.03;
  const offset = startOffset(0.58, 680, rate);
  close((0.58 - offset) / rate, arrivalTime(680) / 1000, "lands on time at speed");
});

test("the same take never plays twice running", () => {
  let previous: number | null = null;
  for (let i = 0; i < 500; i += 1) {
    const take = nextTake(previous, 3);
    assert.notEqual(take, previous);
    assert.ok(take >= 0 && take < 3);
    previous = take;
  }
});

test("after any take, every other take can come next", () => {
  for (const previous of [0, 1, 2]) {
    const seen = new Set([0, 0.49, 0.51, 0.99].map((r) => nextTake(previous, 3, sequence([r]))));
    assert.deepEqual([...seen].sort(), [0, 1, 2].filter((take) => take !== previous));
  }
});

test("a single take is simply played every time", () => {
  assert.equal(nextTake(0, 1), 0);
  assert.equal(nextTake(null, 1), 0);
});

test("a data URI is read without fetching it", () => {
  const bytes = dataUriBytes("data:text/plain;base64,aGVsbG8=");
  assert.ok(bytes);
  assert.equal(new TextDecoder().decode(bytes), "hello");
  assert.equal(new TextDecoder().decode(dataUriBytes("data:,a%20b")!), "a b");
  assert.equal(dataUriBytes("https://example.com/a.mp3"), null);
});

test("the default sounds are MP3 takes, each landing inside itself", () => {
  assert.equal(defaultPageTurnTakes.length, 3);
  assert.equal(defaultBoardTurnTakes.length, 2);
  for (const take of [...defaultPageTurnTakes, ...defaultBoardTurnTakes]) {
    assert.equal(typeof take.src, "string");
    assert.ok((take.src as string).startsWith("data:audio/mpeg;base64,"));
    const bytes = dataUriBytes(take.src as string)!;
    // An MP3 frame or an ID3 tag at the very start.
    const head = new Uint8Array(bytes, 0, 3);
    const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const frame = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    assert.ok(id3 || frame, "starts like an MP3");
    assert.ok(take.landsAt! > 0.3 && take.landsAt! < 0.8, "lands partway through");
  }
});
