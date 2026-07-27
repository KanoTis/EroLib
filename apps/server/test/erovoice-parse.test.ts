import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractAuthorIconUrl,
  extractCoverUrl,
  parseBookmarkHtml,
  parseDetailHtml,
  parseFollowListHtml,
  parseProfileDisplayName,
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
        "https://erovoice-ch.com/wp-content/uploads/2022/03/foo.jpg-e164-232x150.webp",
      ),
      "https://erovoice-ch.com/wp-content/uploads/2022/03/foo.jpg-e164.webp",
    );
  });

  it("prefers filterImage original on CDN", () => {
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

  it("accepts cover on main domain erovoice-ch.com uploads", () => {
    const html = `
      <div id="voiceImagePreview">
        <div class="filterImage" style="background-image:url('https://erovoice-ch.com/wp-content/uploads/2022/03/20130510b03314534056811585.jpg-e1648512435263.webp');"></div>
        <img class="audioSmallImage" src="https://erovoice-ch.com/wp-content/uploads/2022/03/20130510b03314534056811585.jpg-e1648512435263-232x150.webp" />
      </div>
      <img src="https://data.erovoice-ch.com/wp-content/uploads/2026/06/4595fc16f31dc8244aaf58d23efa9700.webp" />
      <meta property="og:image" content="https://erovoice-ch.com/wp-content/uploads/2025/06/top2.png" />
    `;
    assert.equal(
      extractCoverUrl(html),
      "https://erovoice-ch.com/wp-content/uploads/2022/03/20130510b03314534056811585.jpg-e1648512435263.webp",
    );
  });

  it("does not use site top2.png as cover", () => {
    const html = `
      <meta property="og:image" content="https://erovoice-ch.com/wp-content/uploads/2025/06/top2.png" />
      <img src="https://erovoice-ch.com/wp-content/uploads/2025/06/img_siterogo.png" />
    `;
    assert.equal(extractCoverUrl(html), null);
  });
});

describe("erovoice extractAuthorIconUrl", () => {
  it("finds the profile avatar preceding the authorUser heading", () => {
    // Shape confirmed against a live erovoice-ch.com profile page.
    const html = `
      <header><a class="icon"><img src="https://erovoice-ch.com/wp-content/uploads/2025/08/bg_menu.png"></a></header>
      <article class="postUserInfo">
        <span class="hoverImageWrap"><img src="https://data.erovoice-ch.com/wp-content/uploads/2026/05/pic-100x100.webp" width="100" height="100" alt="さなぎさん"></span>
        <section><h1 class="authorUser">さなぎさん</h1></section>
      </article>
    `;
    assert.equal(
      extractAuthorIconUrl(html),
      "https://data.erovoice-ch.com/wp-content/uploads/2026/05/pic.webp",
    );
  });

  it("ignores site chrome icons and returns null without a match", () => {
    const html = `<a class="icon"><img src="https://erovoice-ch.com/wp-content/uploads/2025/08/bg_menu.png"></a>`;
    assert.equal(extractAuthorIconUrl(html), null);
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

  it("stops description at article.discContent before comment chrome", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="【初投稿】ぐちゅぐちゅ音聞いて？" />
        <meta property="og:description" content="初めまして。普段は別の音声投稿サイトにて活動している「すずらん」と申します(´ ˘ \`∗)私の音声聞いて「すず抜き」してくれたら嬉しいです！" />
      </head><body>
        <h1>【初投稿】ぐちゅぐちゅ音聞いて？</h1>
        <section class="voiceDesctiption">
          <article class="discContent">
            初めまして。普段は別の音声投稿サイトにて活動している「すずらん」と申します(´ ˘ \`∗)<br />
私の音声聞いて「すず抜き」してくれたら嬉しいです！
          </article>
        </section>
        <section data-cname="comment">
          <article id="commentArea">
            <p>この音声を聞いた感想をすずらんさんに送ろう♪<br>感想が苦手な方は一言「よかった」でもいいので感想を書いてください♪<br>すずらんさんが喜んでくれます。</p>
            <div id="respond" class="comment-respond">
              <small><a rel="nofollow" id="cancel-comment-reply-link" href="/ero-voice/3029.html#respond">コメントをキャンセル</a></small>
              <form id="commentform" class="comment-form">
                <article class="fixedCommentList"><dl><dt>定型文：</dt><dd><ul>
                  <li><button>コメント</button></li>
                  <li><button>抜いた報告</button></li>
                </ul></dd></dl></article>
              </form>
            </div>
          </article>
        </section>
      </body></html>
    `;
    const meta = parseDetailHtml(
      html,
      "3029",
      "https://erovoice-ch.com/ero-voice/3029.html",
    );
    assert.equal(
      meta.description,
      "初めまして。普段は別の音声投稿サイトにて活動している「すずらん」と申します(´ ˘ \`∗) 私の音声聞いて「すず抜き」してくれたら嬉しいです！",
    );
    assert.ok(meta.description && !meta.description.includes("感想を"));
    assert.ok(meta.description && !meta.description.includes("コメントをキャンセル"));
    assert.ok(meta.description && !meta.description.includes("定型文"));
    assert.ok(meta.description && !meta.description.includes("抜いた報告"));
  });

  it("parses postTime as an absolute publish date", () => {
    const html = `
      <html><head><meta property="og:title" content="タイトル" /></head><body>
        <h1>タイトル</h1>
        <section id="voiceInfos" class="cf">
          <ul class="voiceInfoList">
            <li class="postTime">2026/7/26</li>
            <li class="postView" data-postid="8082">49</li>
          </ul>
        </section>
      </body></html>
    `;
    const meta = parseDetailHtml(
      html,
      "8082",
      "https://erovoice-ch.com/ero-voice/8082.html",
    );
    assert.equal(meta.createdAt, "2026-07-26");
  });

  it("falls back to og:description when discContent is missing", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="タイトルのみ" />
        <meta property="og:description" content="og側の説明文です" />
      </head><body>
        <h1>タイトルのみ</h1>
      </body></html>
    `;
    const meta = parseDetailHtml(
      html,
      "1",
      "https://erovoice-ch.com/ero-voice/1.html",
    );
    assert.equal(meta.description, "og側の説明文です");
  });
});

describe("erovoice parseFollowListHtml", () => {
  it("extracts authorId + displayName from authorUser profile links", () => {
    const html = `
      <ul class="followList">
        <li>
          <a href="/37gionch/"><span class="authorUser">さなぎ</span></a>
        </li>
        <li>
          <a href="https://erovoice-ch.com/foo_bar/">
            <span class="authorUser">Foo 作者</span>
          </a>
        </li>
      </ul>
    `;
    const rows = parseFollowListHtml(html);
    assert.equal(rows.length, 2);
    const a = rows.find((r) => r.authorId === "37gionch");
    assert.equal(a?.username, "37gionch");
    assert.equal(a?.displayName, "さなぎ");
    const b = rows.find((r) => r.authorId === "foo_bar");
    assert.equal(b?.displayName, "Foo 作者");
  });

  it("handles authorUser before href and class on the anchor", () => {
    const html = `
      <div>
        <span class="authorUser">逆序名</span>
        <a href="/revslug/">profile</a>
      </div>
      <a class="authorUser" href="/onanchor/">锚点名</a>
    `;
    const rows = parseFollowListHtml(html);
    const rev = rows.find((r) => r.authorId === "revslug");
    assert.equal(rev?.displayName, "逆序名");
    const on = rows.find((r) => r.authorId === "onanchor");
    assert.equal(on?.displayName, "锚点名");
  });

  it("ignores reserved paths and detail categories", () => {
    const html = `
      <a href="/mypage/"><span class="authorUser">マイページ</span></a>
      <a href="/login/"><span class="authorUser">ログイン</span></a>
      <a href="/ranking/"><span class="authorUser">ランキング</span></a>
      <a href="/voice/"><span class="authorUser">音声</span></a>
      <a href="/ero-voice/"><span class="authorUser">カテゴリ</span></a>
      <a href="/goodslug/"><span class="authorUser">正しい</span></a>
    `;
    const rows = parseFollowListHtml(html);
    assert.deepEqual(
      rows.map((r) => r.authorId).sort(),
      ["goodslug"],
    );
    assert.equal(rows[0]?.displayName, "正しい");
  });

  it("does not treat bare profile links without authorUser as followees", () => {
    // mypage chrome often has self avatar link without authorUser
    const html = `
      <header>
        <a href="/myself_slug/"><img src="/avatar.jpg" alt="me" /></a>
        <a href="/myself_slug/">マイページ</a>
        <a href="/ranking.html">ranking</a>
      </header>
      <div class="followCard">
        <a href="/real_author/"><span class="authorUser">本物</span></a>
      </div>
    `;
    const rows = parseFollowListHtml(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.authorId, "real_author");
    assert.equal(rows[0]?.displayName, "本物");
  });

  it("dedupes by slug and prefers real displayName over slug fallback", () => {
    const html = `
      <a href="/dup/"><span class="authorUser">dup</span></a>
      <a href="/dup/"><span class="authorUser">表示名</span></a>
      <a href="/onlyslug/" class="authorUser"></a>
    `;
    const rows = parseFollowListHtml(html);
    const dup = rows.find((r) => r.authorId === "dup");
    assert.equal(dup?.displayName, "表示名");
    const only = rows.find((r) => r.authorId === "onlyslug");
    // empty authorUser → fallback to slug
    assert.equal(only?.displayName, "onlyslug");
  });

  it("handles multiple authors and absolute hrefs", () => {
    const html = `
      <li data-userid="1"><a href="/aaa/"><span class="authorUser">A</span></a></li>
      <li data-userid="2"><a href="https://erovoice-ch.com/bbb/"><span class="authorUser">B</span></a></li>
      <li data-userid="3"><a href="/ccc/"><span class="authorUser">C</span></a></li>
      <li data-userid="1"><a href="/aaa/"><span class="authorUser">A</span></a></li>
    `;
    const rows = parseFollowListHtml(html);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.authorId).sort(),
      ["aaa", "bbb", "ccc"],
    );
  });

  it("parseProfileDisplayName prefers authorUser heading", () => {
    const html = `
      <html><head><title>よぞらさん | エロボイスちゃんねる</title></head>
      <body><h1 class="authorUser">よぞらさん</h1></body></html>
    `;
    assert.equal(parseProfileDisplayName(html, "yozora_0508_y"), "よぞらさん");
  });
});
