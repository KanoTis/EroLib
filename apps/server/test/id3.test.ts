import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import NodeID3 from "node-id3";
import { ensureMinimalMp3, tagAudioFile } from "../src/media/id3.js";

function commentText(tags: NodeID3.Tags): string {
  const c = tags.comment;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "text" in c) {
    return String((c as { text?: unknown }).text ?? "");
  }
  return String(c ?? "");
}

describe("tagAudioFile", () => {
  it("writes title artist comment and source url into mp3", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "erolib-id3-"));
    try {
      const audioPath = path.join(dir, "audio.mp3");
      await ensureMinimalMp3(audioPath);
      const result = await tagAudioFile({
        audioPath,
        meta: {
          provider: "koekoe",
          workId: "123",
          authorId: "alice",
          authorName: "alice",
          title: "テストタイトル",
          description: "简介内容",
          audioUrl: "https://example.com/a.mp3",
          coverUrl: null,
          sourceUrl: "https://koe-koe.com/detail.php?n=123",
        },
      });
      assert.equal(result.tagged, true);
      const tags = NodeID3.read(audioPath);
      assert.equal(tags.title, "テストタイトル");
      assert.equal(tags.artist, "alice");
      const text = commentText(tags);
      assert.match(text, /简介内容/);
      assert.match(text, /source_url=/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips non-mp3", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "erolib-id3-"));
    try {
      const audioPath = path.join(dir, "audio.m4a");
      await ensureMinimalMp3(audioPath);
      const result = await tagAudioFile({
        audioPath,
        meta: {
          provider: "otobanana",
          workId: "x",
          authorId: null,
          title: "t",
          audioUrl: "https://example.com/a.m4a",
        },
      });
      assert.equal(result.tagged, false);
      assert.equal(result.reason, "unsupported_format");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
