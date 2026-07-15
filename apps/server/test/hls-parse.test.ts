import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptAes128Cbc,
  encryptAes128CbcForTest,
  mediaSequenceIv,
  parseM3u8,
  segmentIv,
} from "../src/providers/hls.js";

const SAMPLE = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/keygen.php",IV=0x00000000000000000000000000000000
#EXTINF:10.005333,
https://sgp1.digitaloceanspaces.com/bucket/0000.ts?sig=1
#EXTINF:10.005333,
https://sgp1.digitaloceanspaces.com/bucket/0001.ts?sig=2
#EXT-X-ENDLIST
`;

describe("parseM3u8", () => {
  it("parses AES-128 VOD playlist with absolute segment URIs", () => {
    const p = parseM3u8(SAMPLE, "https://erovoice-ch.com/playlist.m3u8");
    assert.equal(p.method, "AES-128");
    assert.equal(p.endList, true);
    assert.equal(p.playlistType, "VOD");
    assert.equal(p.mediaSequence, 0);
    assert.equal(p.segments.length, 2);
    assert.equal(
      p.keyUri,
      "https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/keygen.php",
    );
    assert.ok(p.iv);
    assert.equal(p.iv?.equals(Buffer.alloc(16, 0)), true);
    assert.equal(
      p.segments[0]?.uri,
      "https://sgp1.digitaloceanspaces.com/bucket/0000.ts?sig=1",
    );
  });

  it("resolves relative segment and key URIs", () => {
    const body = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-KEY:METHOD=AES-128,URI="keygen.php"
#EXTINF:1,
seg0.ts
#EXT-X-ENDLIST
`;
    const p = parseM3u8(
      body,
      "https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/get.m3u8",
    );
    assert.equal(
      p.keyUri,
      "https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/keygen.php",
    );
    assert.equal(
      p.segments[0]?.uri,
      "https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/seg0.ts",
    );
    assert.equal(p.iv, null);
    assert.equal(
      segmentIv(p, 0).equals(mediaSequenceIv(5)),
      true,
    );
  });

  it("rejects missing EXT-M3U", () => {
    assert.throws(() => parseM3u8("not a playlist"), /Invalid m3u8/);
  });
});

describe("decryptAes128Cbc", () => {
  it("round-trips PKCS#7 padded payload", () => {
    const key = Buffer.alloc(16, 0x42);
    const iv = Buffer.alloc(16, 0);
    const plain = Buffer.from("hello erovoice hls segment!!");
    const enc = encryptAes128CbcForTest(plain, key, iv);
    const dec = decryptAes128Cbc(enc, key, iv);
    assert.equal(dec.equals(plain), true);
  });
});
