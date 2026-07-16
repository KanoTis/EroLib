import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  decryptJson,
  encryptJson,
  encryptString,
  decryptString,
} from "../src/crypto/credentials.js";
import {
  isLocalAudioAvailable,
  mediaWorkDir,
  resolveAuthorId,
  sanitizePathSegment,
  UNKNOWN_AUTHOR,
} from "../src/storage/paths.js";

import {
  parseBookmarkIds,
  parseDetail,
  parseNextMypagePage,
} from "../src/providers/koekoe.js";

describe("credentials crypto", () => {
  it("roundtrips JSON payloads", () => {
    const secret = "test-secret-at-least-16-chars";
    const payload = { mode: "password", username: "u", password: "p" };
    const blob = encryptJson(secret, payload);
    const out = decryptJson<typeof payload>(secret, blob);
    assert.deepEqual(out, payload);
  });

  it("roundtrips strings", () => {
    const secret = "another-secret-value!!";
    const enc = encryptString(secret, "hello");
    assert.equal(decryptString(secret, enc), "hello");
  });

  it("fails with wrong secret", () => {
    const blob = encryptJson("secret-aaaaaaaaaaaa", { a: 1 });
    assert.throws(() => decryptJson("secret-bbbbbbbbbbbb", blob));
  });
});

describe("media paths", () => {
  it("uses _unknown for missing author", () => {
    assert.equal(resolveAuthorId(null), UNKNOWN_AUTHOR);
    assert.equal(resolveAuthorId(""), UNKNOWN_AUTHOR);
  });

  it("sanitizes path segments", () => {
    assert.equal(sanitizePathSegment("a/b:c"), "a_b_c");
  });

  it("builds stable media dirs", () => {
    const m = mediaWorkDir("/media", "koekoe", "author1", "123");
    assert.ok(m.dir.replace(/\\/g, "/").endsWith("/media/koekoe/author1/123"));
    assert.ok(m.audio("mp3").endsWith("audio.mp3"));
    assert.ok(m.metaJson.endsWith("meta.json"));
  });
});

describe("isLocalAudioAvailable", () => {
  let mediaRoot = "";

  afterEach(async () => {
    if (mediaRoot) {
      await rm(mediaRoot, { recursive: true, force: true });
      mediaRoot = "";
    }
  });

  async function setupMediaRoot(): Promise<string> {
    mediaRoot = await mkdtemp(path.join(tmpdir(), "erolib-audio-"));
    return mediaRoot;
  }

  it("returns true when audio exists and size > 0", async () => {
    const root = await setupMediaRoot();
    const relDir = path.join("koekoe", "author1", "123");
    const dir = path.join(root, relDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "audio.mp3"), "not-empty");

    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: relDir,
        audioExt: "mp3",
      }),
      true,
    );
  });

  it("returns false when audio is missing", async () => {
    const root = await setupMediaRoot();
    const relDir = path.join("koekoe", "author1", "123");
    await mkdir(path.join(root, relDir), { recursive: true });

    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: relDir,
        audioExt: "mp3",
      }),
      false,
    );
  });

  it("returns false for zero-byte audio", async () => {
    const root = await setupMediaRoot();
    const relDir = path.join("koekoe", "author1", "123");
    const dir = path.join(root, relDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "audio.mp3"), "");

    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: relDir,
        audioExt: "mp3",
      }),
      false,
    );
  });

  it("returns false when mediaRelDir or audioExt is missing", async () => {
    const root = await setupMediaRoot();
    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: null,
        audioExt: "mp3",
      }),
      false,
    );
    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: "koekoe/a/1",
        audioExt: null,
      }),
      false,
    );
    assert.equal(
      await isLocalAudioAvailable(root, {
        mediaRelDir: "",
        audioExt: "mp3",
      }),
      false,
    );
  });
});

describe("koekoe parsers", () => {
  it("extracts bookmark ids", () => {
    const html = `
      <a href="detail.php?n=761964">x</a>
      <a href="detail.php?n=100">y</a>
      <a href="detail.php?n=761964">dup</a>
    `;
    assert.deepEqual(parseBookmarkIds(html), ["761964", "100"]);
  });

  it("parses mypage next page from prev/next-only pager", () => {
    const mid = `
      <a href="mypage.php">prev</a>
      <a href="mypage.php?p=3">next</a>
      <a href="detail.php?n=1">x</a>
    `;
    assert.equal(parseNextMypagePage(mid), 3);

    const last = `
      <a href="mypage.php?p=3">prev</a>
      <a href="detail.php?n=1">x</a>
    `;
    assert.equal(parseNextMypagePage(last), null);

    const first = `<a href="mypage.php?p=2">next</a>`;
    assert.equal(parseNextMypagePage(first), 2);
  });

  it("parses detail page", () => {
    const html = `
      <h2>テストタイトル</h2>
      <audio><source src="//file.koe-koe.com/sound/upload/761964.mp3" type="audio/mp3"></audio>
      <div class="audioTime audioTime_female">4分48秒</div>
      <a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a>
      <img src="/img/female3.png">
      <div class="desc detail"><p>説明テキスト</p></div>
    `;
    const meta = parseDetail(html, "761964");
    assert.equal(meta.title, "テストタイトル");
    assert.equal(meta.workId, "761964");
    assert.equal(meta.audioUrl, "https://file.koe-koe.com/sound/upload/761964.mp3");
    assert.equal(meta.durationSeconds, 4 * 60 + 48);
    assert.equal(meta.authorName, "alice");
    assert.equal(meta.description, "説明テキスト");
    assert.equal(meta.coverUrl, null);
    assert.equal(meta.sourceUrl, "https://koe-koe.com/detail.php?n=761964");
  });
});
