import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeUsernameInput,
  parseOnairPayload,
  pickExactUsername,
} from "../src/providers/otobanana-live.js";

describe("otobanana live helpers", () => {
  it("strips leading @ from username input", () => {
    assert.equal(normalizeUsernameInput("@hideyooooooooo"), "hideyooooooooo");
    assert.equal(normalizeUsernameInput("  name  "), "name");
  });

  it("picks exact username from search payload", () => {
    const payload = {
      data: [
        { id: "u1", username: "other", name: "O" },
        { id: "u2", username: "hideyooooooooo", name: "H" },
      ],
    };
    const hit = pickExactUsername(payload, "hideyooooooooo");
    assert.deepEqual(hit, {
      authorId: "u2",
      username: "hideyooooooooo",
      displayName: "H",
    });
  });

  it("rejects zero or multiple exact username matches", () => {
    assert.equal(
      pickExactUsername({ data: [{ id: "u1", username: "a" }] }, "b"),
      null,
    );
    assert.equal(
      pickExactUsername(
        {
          data: [
            { id: "u1", username: "x" },
            { id: "u2", username: "x" },
          ],
        },
        "x",
      ),
      null,
    );
  });

  it("parses onair room payload", () => {
    const room = parseOnairPayload({
      room_id:
        "realtime:802b8dfd-3f0c-406a-b89b-cd3333c9d971:906a876a-805c-4e36-8f2f-b3a7ace4938b",
      post_ptr_id: "post-1",
      stream_service: "realtime",
      is_open: true,
      is_adult: false,
      listener_count: 2,
      room_open_at: "2026-07-16T03:26:25.000000Z",
      post: {
        id: "post-1",
        title: "直播标题",
        user_id: "802b8dfd-3f0c-406a-b89b-cd3333c9d971",
        user: {
          id: "802b8dfd-3f0c-406a-b89b-cd3333c9d971",
          username: "hideyooooooooo",
          name: "🧸",
        },
      },
    });
    assert.ok(room);
    assert.equal(room.authorId, "802b8dfd-3f0c-406a-b89b-cd3333c9d971");
    assert.equal(room.username, "hideyooooooooo");
    assert.equal(room.streamService, "realtime");
    assert.equal(room.isOpen, true);
    assert.equal(room.postPtrId, "post-1");
  });

  it("returns null for offline/invalid onair payload", () => {
    assert.equal(parseOnairPayload({}), null);
    assert.equal(parseOnairPayload(null), null);
  });
});
