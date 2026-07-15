import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDetail } from "../src/providers/koekoe.js";

const SITE_SLOGAN =
  "スマートフォンから録音した音声を投稿できる音声掲示板です。エロ声やオナニーボイス、喘ぎ声などエッチでアダルトな音声の投稿をお待ちしています。";

describe("koekoe parseDetail", () => {
  it("parses title description and never uses gender icon as cover", () => {
    const html = `
      <html><head>
        <title>${SITE_SLOGAN}</title>
        <meta property="og:title" content="ビデオ通話で見られながらオナニーしてみた" />
      </head><body>
        <h2>${SITE_SLOGAN}</h2>
        <h2>ビデオ通話で見られながらオナニーしてみた</h2>
        <audio preload="metadata" controls>
          <source src="//file.koe-koe.com/sound/upload/761964.mp3" type="audio/mp3">
        </audio>
        <div class="audioTime audioTime_female">4分48秒</div>
        <a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a>
        <img src="/img/female3.png">
        <div class="desc detail"><p>我慢できなくて投稿しました</p></div>
      </body></html>
    `;
    const meta = parseDetail(html, "761964");
    assert.equal(meta.title, "ビデオ通話で見られながらオナニーしてみた");
    assert.equal(meta.description, "我慢できなくて投稿しました");
    assert.equal(meta.coverUrl, null);
    assert.equal(meta.sourceUrl, "https://koe-koe.com/detail.php?n=761964");
    assert.equal(meta.authorName, "alice");
    assert.equal(meta.audioUrl, "https://file.koe-koe.com/sound/upload/761964.mp3");
  });

  it("rejects slogan-only pages as workId fallback title", () => {
    const html = `
      <title>${SITE_SLOGAN}</title>
      <h2>${SITE_SLOGAN}</h2>
      <audio><source src="//file.koe-koe.com/sound/upload/1.mp3"></audio>
    `;
    const meta = parseDetail(html, "1");
    assert.equal(meta.title, "1");
    assert.equal(meta.coverUrl, null);
  });
});
