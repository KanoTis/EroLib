import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorCastsPageUrl,
  withAuthorCastsIsAdult,
} from "../src/providers/otobanana.js";

describe("otobanana authorCastsPageUrl", () => {
  it("always includes is_adult for adult and non-adult pages", () => {
    const nonAdult = authorCastsPageUrl("kei7241", 50, 0, false);
    const adult = authorCastsPageUrl("kei7241", 50, 50, true);

    assert.match(
      nonAdult,
      /\/api\/users\/kei7241\/casts\?limit=50&offset=0&is_adult=false$/,
    );
    assert.match(
      adult,
      /\/api\/users\/kei7241\/casts\?limit=50&offset=50&is_adult=true$/,
    );
    assert.ok(nonAdult.includes("is_adult=false"));
    assert.ok(adult.includes("is_adult=true"));
    assert.ok(!nonAdult.includes("is_adult=true"));
  });

  it("encodes author id in path", () => {
    const url = authorCastsPageUrl("user/with space", 50, 0, true);
    assert.ok(url.includes("/api/users/user%2Fwith%20space/casts?"));
    assert.ok(url.endsWith("is_adult=true"));
  });
});

describe("otobanana withAuthorCastsIsAdult", () => {
  it("injects is_adult when next_page_url omits it", () => {
    const next =
      "https://api.v2.otobanana.com/api/users/kei7241/casts?limit=50&offset=50";
    const fixed = withAuthorCastsIsAdult(next, true);
    assert.ok(fixed.includes("is_adult=true"));
    assert.ok(fixed.includes("offset=50"));
  });

  it("overwrites wrong is_adult on next_page_url", () => {
    const next =
      "https://api.v2.otobanana.com/api/users/kei7241/casts?limit=50&offset=50&is_adult=false";
    const fixed = withAuthorCastsIsAdult(next, true);
    assert.ok(fixed.includes("is_adult=true"));
    assert.ok(!/[?&]is_adult=false(?:&|$)/.test(fixed));
  });
});
