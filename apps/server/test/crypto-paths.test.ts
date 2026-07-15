import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptJson,
  encryptJson,
  encryptString,
  decryptString,
} from "../src/crypto/credentials.js";
import {
  mediaWorkDir,
  resolveAuthorId,
  sanitizePathSegment,
  UNKNOWN_AUTHOR,
} from "../src/storage/paths.js";
import { parseBookmarkIds, parseDetail } from "../src/providers/koekoe.js";

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

describe("koekoe parsers", () => {
  it("extracts bookmark ids", () => {
    const html = `
      <a href="detail.php?n=761964">x</a>
      <a href="detail.php?n=100">y</a>
      <a href="detail.php?n=761964">dup</a>
    `;
    assert.deepEqual(parseBookmarkIds(html), ["761964", "100"]);
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
