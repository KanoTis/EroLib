import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextLiveAudioFileName,
  shouldReplaceLiveMedia,
} from "../src/jobs/live-recorder.js";

describe("nextLiveAudioFileName", () => {
  it("uses audio.ogg when dir empty", () => {
    assert.equal(nextLiveAudioFileName([]), "audio.ogg");
  });

  it("uses audio_2 when audio.ogg exists", () => {
    assert.equal(nextLiveAudioFileName(["audio.ogg"]), "audio_2.ogg");
  });

  it("increments past highest N", () => {
    assert.equal(
      nextLiveAudioFileName(["audio.ogg", "audio_2.ogg", "audio_5.ogg", "other.txt"]),
      "audio_6.ogg",
    );
  });
});

describe("shouldReplaceLiveMedia", () => {
  it("replaces when no existing bytes", () => {
    assert.equal(shouldReplaceLiveMedia(null, 100), true);
    assert.equal(shouldReplaceLiveMedia(undefined, 100), true);
  });

  it("replaces only when new is larger", () => {
    assert.equal(shouldReplaceLiveMedia(1000, 2000), true);
    assert.equal(shouldReplaceLiveMedia(2000, 2000), false);
    assert.equal(shouldReplaceLiveMedia(2000, 500), false);
  });
});
