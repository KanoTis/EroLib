import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractCoverUrl,
  parseBookmarkHtml,
  parseDetailHtml,
  preferOriginalImageUrl,
} from "../src/providers/erovoice.js";

describe("erovoice parseBookmarkHtml", () => {
  it("extracts post ids from detail links and data-postid", () => {
    const html = `
      <ul class="voiceList cf full bookmark">
        <li data-postid="7993">
          <a href="/ero-voice/7993.html" title="作品A"><span class="title">作品A</span></a>
          <a href="/37gionch/"><span class="authorUser">さなぎ</span></a>
        </li>
        <li>
          <a href="https://erovoice-ch.com/ero-asmr/1001.html" title="asmr作品">asmr</a>
        </li>
        <li>
          <a href="https://erovoice-ch.com/ero-voice/7846.html" title="おふろ】指でくちゅくちゅオナニー">
            <div class="postImageWrap"></div>
          </a>
        </li>
      </ul>
    `;
    const cards = parseBookmarkHtml(html);
    const ids = cards.map((c) => c.workId).sort();
    assert.deepEqual(ids, ["1001", "7846", "7993"]);
    const a = cards.find((c) => c.workId === "7993");
    assert.equal(a?.authorId, "37gionch");
    assert.equal(a?.category, "ero-voice");
    assert.equal(a?.title, "作品A");
    assert.equal(
      cards.find((c) => c.workId === "7846")?.title,
      "おふろ】指でくちゅくちゅオナニー",
    );
  });
});

describe("erovoice cover urls", () => {
  it("strips WordPress size suffixes", () => {
    assert.equal(
      preferOriginalImageUrl(
        "https://data.erovoice-ch.com/wp-content/uploads/2026/02/foo-113x150.webp",
      ),
      "https://data.erovoice-ch.com/wp-content/uploads/2026/02/foo.webp",
    );
    assert.equal(
      preferOriginalImageUrl(
        "https://data.erovoice-ch.com/wp-content/uploads/2026/02/foo-100x100.webp?x=1",
      ),
      "https://data.erovoice-ch.com/wp-content/uploads/2026/02/foo.webp?x=1",
    );
  });

  it("prefers filterImage original over thumbnail img", () => {
    const html = `
      <div id="voiceImagePreview">
        <div class="filterImage" style="background-image:url('https://data.erovoice-ch.com/wp-content/uploads/2026/02/2026021123134720260211_231136.webp');"></div>
        <img class="audioSmallImage" src="https://data.erovoice-ch.com/wp-content/uploads/2026/02/2026021123134720260211_231136-113x150.webp" />
      </div>
      <meta property="og:image" content="https://erovoice-ch.com/wp-content/uploads/2025/06/top2.png" />
    `;
    assert.equal(
      extractCoverUrl(html),
      "https://data.erovoice-ch.com/wp-content/uploads/2026/02/2026021123134720260211_231136.webp",
    );
  });
});

describe("erovoice parseDetailHtml", () => {
  it("parses title author cover duration and tags", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="テスト音声タイトル" />
        <meta property="og:image" content="https://erovoice-ch.com/wp-content/uploads/2025/06/top2.png" />
      </head><body>
        <h1>テスト音声タイトル</h1>
        <div id="voiceImagePreview">
          <div class="filterImage" style="background-image:url('https://data.erovoice-ch.com/wp-content/uploads/2026/02/cover-full.webp');"></div>
          <img src="https://data.erovoice-ch.com/wp-content/uploads/2026/02/cover-full-113x150.webp" />
        </div>
        <a href="/37gionch/"><span class="authorUser">さなぎ</span></a>
        <div class="discContent">説明文です</div>
        <span class="controls__total-time">26:26</span>
        <ul class="voiceTags">
          <li>オホ声</li>
          <li>ディルド</li>
        </ul>
      </body></html>
    `;
    const meta = parseDetailHtml(
      html,
      "7993",
      "https://erovoice-ch.com/ero-voice/7993.html",
    );
    assert.equal(meta.provider, "erovoice");
    assert.equal(meta.workId, "7993");
    assert.equal(meta.title, "テスト音声タイトル");
    assert.equal(meta.authorId, "37gionch");
    assert.equal(meta.authorName, "さなぎ");
    assert.equal(
      meta.coverUrl,
      "https://data.erovoice-ch.com/wp-content/uploads/2026/02/cover-full.webp",
    );
    assert.equal(meta.durationSeconds, 26 * 60 + 26);
    assert.equal(meta.description, "説明文です");
    assert.deepEqual(meta.tags, ["オホ声", "ディルド"]);
    assert.match(meta.audioUrl, /getm3u8file_origints\.php\?id=7993$/);
  });
});
