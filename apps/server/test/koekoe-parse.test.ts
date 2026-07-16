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
        <div class="desc detail">
          <p><a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a> : 我慢できなくて投稿しました</p>
          <p class="meta detail"><span class="meta_item">エロ声</span></p>
          <p class="b_btn"><a href="add_bookmark.php?n=761964">+ブックマークする</a></p>
        </div>
        <img src="/img/female3.png">
      </body></html>
    `;
    const meta = parseDetail(html, "761964");
    assert.equal(meta.title, "ビデオ通話で見られながらオナニーしてみた");
    assert.equal(meta.description, "我慢できなくて投稿しました");
    assert.equal(meta.coverUrl, null);
    assert.equal(meta.sourceUrl, "https://koe-koe.com/detail.php?n=761964");
    assert.equal(meta.authorName, "alice");
    assert.equal(meta.authorId, "alice");
    assert.equal(meta.audioUrl, "https://file.koe-koe.com/sound/upload/761964.mp3");
  });

  it("keeps post body only and includes trip in author identity", () => {
    // Shape from https://koe-koe.com/detail.php?n=763027
    const html = `
      <html><head>
        <title>初投稿です [763027] - Koe-Koe 音声掲示板</title>
        <meta property="og:title" content="初投稿です [763027] - Koe-Koe 音声掲示板"/>
      </head><body>
        <h2 class="sub_title">${SITE_SLOGAN}</h2>
        <h2>初投稿です</h2>
        <div id="voice">
          <audio preload="metadata" controls>
            <source src="//file.koe-koe.com/sound/upload/763027.mp3" type="audio/mp3" />
          </audio>
        </div>
        <div class="content addition">
          <div id="text" class="content-inner">
            <div class="icon addition">
              <img style="width: 60px; height: 60px;" src="/img/female3.png">
              <div class="audioTime audioTime_1">1分46秒</div>
            </div>
            <div class="desc detail">
              <p><a href="search.php?word=%E3%81%A1%E3%81%B2%E3%82%8D&g=1&m=1"><span class="user_name">ちひろ</span></a>◆TfWM43xdFw : 吸うやつでオナニーしました<br>イク時だけ声大きくてめちゃくちゃ恥ずかしい…</p>
              <p class="meta detail">
                <span class="meta_item"><a href="list.php?g=1&g2=1">エロ声</a></span>
                <span class="meta_item"><span class="metaIcon_up">@1日前</span></span>
              </p>
              <p class="b_btn"><a href="add_bookmark.php?n=763027" rel="nofollow">+ブックマークする</a></p>
            </div>
          </div>
        </div>
        <h2>注目の音声(総合)</h2>
        <div class="desc">
          <p class="desc_auth_title"><span class="entry_auth">まゆ</span>: ビデオ通話で見られながらオナニーしてみた</p>
        </div>
      </body></html>
    `;
    const meta = parseDetail(html, "763027");
    assert.equal(meta.title, "初投稿です");
    assert.equal(
      meta.description,
      "吸うやつでオナニーしました\nイク時だけ声大きくてめちゃくちゃ恥ずかしい…",
    );
    assert.equal(meta.authorName, "ちひろ◆TfWM43xdFw");
    assert.equal(meta.authorId, "ちひろ◆TfWM43xdFw");
    assert.equal(meta.extra?.trip, "TfWM43xdFw");
    assert.equal(meta.coverUrl, null);
    assert.equal(meta.durationSeconds, 1 * 60 + 46);
    assert.equal(meta.audioUrl, "https://file.koe-koe.com/sound/upload/763027.mp3");
  });

  it("includes ナンネット ID marker in author identity", () => {
    const html = `
      <h2>スキスキたくさん言ったよ</h2>
      <audio><source src="//file.koe-koe.com/sound/upload/763053.mp3" type="audio/mp3"></audio>
      <div class="desc detail">
        <p><a href="search.php?word=natsu&g=1&m=1"><span class="user_name">なつです</span></a>◇ID_76293 : 本文です</p>
        <p class="meta detail">@1日前</p>
      </div>
    `;
    const meta = parseDetail(html, "763053");
    assert.equal(meta.authorName, "なつです◇ID_76293");
    assert.equal(meta.authorId, "なつです◇ID_76293");
    assert.equal(meta.extra?.nanId, "ID_76293");
    assert.equal(meta.description, "本文です");
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
