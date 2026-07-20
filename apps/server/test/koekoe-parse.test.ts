import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  koeKoeAuthorMatches,
  koeKoeAuthorSearchBase,
  normalizeKoeKoeAuthorKey,
  parseAuthorSearchHits,
  parseDetail,
  parseListCards,
  parseNextListPage,
} from "../src/providers/koekoe.js";

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

describe("koekoe parseListCards / parseNextListPage", () => {
  it("extracts work ids from search/list HTML with author hint", () => {
    const html = `
      <div class="list">
        <h2><a href="detail.php?n=1001">作品一</a></h2>
        <p><a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a></p>
        <a href="detail.php?n=1002">作品二</a>
        <a href="detail.php?n=1001">dup</a>
      </div>
    `;
    const cards = parseListCards(html, "alice");
    assert.deepEqual(
      cards.map((c) => c.workId).sort(),
      ["1001", "1002"],
    );
    assert.equal(cards[0]?.provider, "koekoe");
    assert.ok(cards.every((c) => c.authorId));
  });

  it("finds next page from pager links", () => {
    const html = `
      <a href="search.php?word=alice&m=1&p=1">1</a>
      <a href="search.php?word=alice&m=1&p=2">2</a>
      <a href="search.php?word=alice&m=1&p=3">3</a>
      <a href="search.php?word=alice&m=1&p=2">next</a>
    `;
    assert.equal(parseNextListPage(html, 1), 2);
    assert.equal(parseNextListPage(`<span>done</span>`, 1), null);
  });
});

describe("koekoe author identity helpers", () => {
  it("normalizes trip slash forms and trims", () => {
    assert.equal(
      normalizeKoeKoeAuthorKey("  黒猫◆_HV2b6TqMw  "),
      "黒猫◆/HV2b6TqMw",
    );
    assert.equal(
      normalizeKoeKoeAuthorKey("黒猫◆/HV2b6TqMw"),
      "黒猫◆/HV2b6TqMw",
    );
  });

  it("strips trip / nan marker for search base word", () => {
    assert.equal(koeKoeAuthorSearchBase("黒猫◆/HV2b6TqMw"), "黒猫");
    assert.equal(koeKoeAuthorSearchBase("黒猫◆_HV2b6TqMw"), "黒猫");
    assert.equal(koeKoeAuthorSearchBase("なつです◇ID_76293"), "なつです");
    assert.equal(koeKoeAuthorSearchBase("alice"), "alice");
  });

  it("matches full identity and base-only subscription rules", () => {
    const trip = "黒猫◆/HV2b6TqMw";
    assert.equal(koeKoeAuthorMatches("黒猫◆/HV2b6TqMw", trip), true);
    assert.equal(koeKoeAuthorMatches("黒猫◆_HV2b6TqMw", trip), true);
    // Same base, different trip — reject
    assert.equal(koeKoeAuthorMatches("黒猫◆/otherTrip", trip), false);
    // Base-only card while subscribed to trip — reject (avoid same-name bleed)
    assert.equal(koeKoeAuthorMatches("黒猫", trip), false);

    // Base-only subscription: accept base and base+marker
    assert.equal(koeKoeAuthorMatches("alice", "alice"), true);
    assert.equal(koeKoeAuthorMatches("alice◆trip1", "alice"), true);
    assert.equal(koeKoeAuthorMatches("bob", "alice"), false);
    assert.equal(koeKoeAuthorMatches(null, "alice"), false);
  });
});

describe("koekoe parseAuthorSearchHits", () => {
  it("dedupes authors from user_name and search links", () => {
    const html = `
      <div class="list">
        <p><a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a>◆trip1</p>
        <p><span class="user_name">bob</span></p>
        <p><a href="search.php?word=alice&g=1&m=1"><span class="user_name">alice</span></a></p>
        <a href="search.php?word=carol&m=1">carol only link</a>
      </div>
    `;
    const hits = parseAuthorSearchHits(html);
    const ids = hits.map((h) => h.authorId).sort();
    assert.ok(ids.includes("alice◆trip1") || ids.includes("alice"));
    assert.ok(ids.includes("bob"));
    assert.ok(ids.includes("carol"));
    assert.equal(new Set(ids).size, ids.length);
  });

  it("extracts authors from list-card entry_auth (search.php shape)", () => {
    const html = `
      <div class="desc">
        <p class="desc_auth_title"><span class="entry_auth">ちひろ</span> : 作品A</p>
        <p class="desc_auth_title"><span class="entry_auth">なつです</span>◇ID_76293 : 作品B</p>
        <p class="desc_auth_title"><span class="entry_auth">ちひろ</span> : 作品C</p>
      </div>
    `;
    const hits = parseAuthorSearchHits(html);
    const ids = hits.map((h) => h.authorId);
    assert.ok(ids.includes("ちひろ"));
    assert.ok(ids.includes("なつです◇ID_76293"));
    assert.equal(ids.filter((id) => id === "ちひろ").length, 1);

    const filtered = parseAuthorSearchHits(html, "ちひろ");
    assert.deepEqual(
      filtered.map((h) => h.authorId),
      ["ちひろ"],
    );
  });
});
