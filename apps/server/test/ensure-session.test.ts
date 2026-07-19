import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCredentialAuthError } from "../src/providers/ensure-session.js";

describe("isCredentialAuthError", () => {
  it("detects password / cookie rejections", () => {
    assert.equal(
      isCredentialAuthError("Erovoice 登录失败：用户名或密码错误"),
      true,
    );
    assert.equal(
      isCredentialAuthError("Koe-koe login failed (credentials rejected)"),
      true,
    );
    assert.equal(
      isCredentialAuthError("Otobanana login failed: HTTP 400 — invalid"),
      true,
    );
    assert.equal(
      isCredentialAuthError("Koe-koe cookie session invalid (mypage check failed)"),
      true,
    );
    assert.equal(
      isCredentialAuthError("Erovoice Cookie 无效或已过期，请从浏览器复制登录后的 Cookie 后重试"),
      true,
    );
  });

  it("does not treat transient network errors as auth failures", () => {
    assert.equal(isCredentialAuthError("fetch failed"), false);
    assert.equal(isCredentialAuthError("ECONNRESET"), false);
    assert.equal(isCredentialAuthError("timeout of 30000ms exceeded"), false);
    assert.equal(isCredentialAuthError("HTTP 500"), false);
    assert.equal(
      isCredentialAuthError("Otobanana login failed: HTTP 503"),
      false,
    );
  });
});
