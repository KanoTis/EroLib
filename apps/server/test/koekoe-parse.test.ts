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
    // Relative label only — no absolute day; keep raw for UI fallback.
    assert.equal(meta.createdAt, null);
    assert.equal(meta.extra?.postedAtRaw, "@1日前");
  });

  it("parses absolute @YY/M/D publish date from detail meta", () => {
    const html = `
      <h2>ちくばんちくびをかりかりしながらひとりえっち</h2>
      <audio><source src="//file.koe-koe.com/sound/upload/575558.mp3" type="audio/mp3"></audio>
      <div class="desc detail">
        <p><a href="search.php?word=黒猫&g=1&m=1"><span class="user_name">黒猫</span></a>◆/HV2b6TqMw : body</p>
        <p class="meta detail">
          <span class="meta_item"><a href="list.php?g=1&g2=2">オナ声</a></span>
          <span class="meta_item"><span class="metaIcon_up">@24/10/5</span></span>
        </p>
      </div>
    `;
    const meta = parseDetail(html, "575558");
    assert.equal(meta.title, "ちくばんちくびをかりかりしながらひとりえっち");
    assert.equal(meta.createdAt, "2024-10-05");
    assert.equal(meta.extra?.postedAtRaw, "@24/10/5");
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

  it("uses desc_auth_title text after colon, not duration/meta chrome", () => {
    // Shape from list.php / search.php (issue #12: title swallowed meta).
    const html = `
      <div class="content">
        <a href="detail.php?n=575558" title="「黒猫(女性)/ちくばんちくびをかりかりしながらひとりえっち」の投稿">
          <div class="content-inner">
            <div class="icon icon_female">
              <div class="audioTime audioTime_female">4分</div>
            </div>
            <div class="desc">
              <p class="desc_auth_title"><span class="entry_auth">黒猫</span>◆/HV2b6TqMw : ちくばんちくびをかりかりしながらひとりえっち</p>
              <p class="meta addition">
                <span class="meta_item">コメ : 2</span>
                <span class="meta_item">いいね : 22</span>
                <span class="meta_item"><span class="metaIcon_up">@24/10/5</span></span>
              </p>
            </div>
          </div>
        </a>
      </div>
      <div class="content">
        <a href="detail.php?n=765171" title="「ゆめな(女性)/1000円でえっちなこと何でもします♡」の投稿">
          <div class="content-inner">
            <div class="icon icon_female">
              <div class="audioTime audioTime_female">44秒</div>
            </div>
            <div class="desc">
              <p class="desc_auth_title"><span class="entry_auth">ゆめな</span> : 1000円でえっちなこと何でもします♡</p>
              <p class="meta addition">
                <span class="meta_item">コメ : 0</span>
                <span class="meta_item">いいね : 0</span>
                <span class="meta_item"><span class="metaIcon_up">@16分前</span></span>
              </p>
            </div>
          </div>
        </a>
      </div>
    `;
    const cards = parseListCards(html);
    assert.equal(cards.length, 2);

    const issue = cards.find((c) => c.workId === "575558");
    assert.ok(issue);
    assert.equal(issue?.title, "ちくばんちくびをかりかりしながらひとりえっち");
    assert.equal(issue?.authorName, "黒猫◆/HV2b6TqMw");
    assert.equal(issue?.authorId, "黒猫◆/HV2b6TqMw");
    assert.ok(issue?.title && !issue.title.includes("コメ"));
    assert.ok(issue?.title && !issue.title.includes("いいね"));
    assert.ok(issue?.title && !/^4分/.test(issue.title));

    const second = cards.find((c) => c.workId === "765171");
    assert.equal(second?.title, "1000円でえっちなこと何でもします♡");
    assert.equal(second?.authorName, "ゆめな");
  });

  it("falls back to anchor title attribute when desc_auth_title missing", () => {
    const html = `
      <a href="detail.php?n=1003" title="「alice(女性)/フォールバックタイトル」の投稿">
        <div class="audioTime">1分</div>
        <span class="entry_auth">alice</span>
      </a>
    `;
    const cards = parseListCards(html);
    assert.equal(cards[0]?.workId, "1003");
    assert.equal(cards[0]?.title, "フォールバックタイトル");
    assert.equal(cards[0]?.authorName, "alice");
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
