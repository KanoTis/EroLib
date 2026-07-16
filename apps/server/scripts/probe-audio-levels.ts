import { chromium } from "playwright";

const EMAIL = process.env.OTOBANANA_EMAIL;
const PASSWORD = process.env.OTOBANANA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error("Set OTOBANANA_EMAIL and OTOBANANA_PASSWORD");
}
const API = "https://api.v2.otobanana.com";
const WS = "wss://api.v3.otobanana.com/ws";
const HEADED = process.env.HEADED === "1";

async function main(): Promise<void> {
  const login = (await (
    await fetch(`${API}/api/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://otobanana.com",
      },
      body: JSON.stringify({ Email: EMAIL, Password: PASSWORD }),
    })
  ).json()) as { accessToken?: string };
  const token = login.accessToken;
  if (!token) throw new Error("no token");

  const list = (await (
    await fetch(`${API}/api/top/livestreams?is_adult=true`, {
      headers: { Authorization: token },
    })
  ).json()) as { data?: Array<Record<string, unknown>> };

  const rooms = (list.data ?? [])
    .filter(
      (x) => x.is_open === true && x.stream_service === "realtime",
    )
    .sort(
      (a, b) =>
        Number(b.listener_count ?? 0) - Number(a.listener_count ?? 0),
    );
  const room = rooms[0];
  if (!room) throw new Error("no room");
  const post = String(room.post_ptr_id);
  console.log("room", post, "listeners", room.listener_count);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.goto("https://otobanana.com/", {
    waitUntil: "domcontentloaded",
  });

  const result = await page.evaluate(
    async (args: {
      api: string;
      ws: string;
      post: string;
      token: string;
    }) => {
      const { api, ws, post, token } = args;
      const join = (await (
        await fetch(`${api}/api/livestreams/realtime/${post}/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
            Origin: "https://otobanana.com",
          },
          body: JSON.stringify({
            livestream_join_token: crypto.randomUUID(),
          }),
        })
      ).json()) as {
        sessionId: string;
        iceServers?: RTCIceServer[];
      };

      const pc = new RTCPeerConnection({
        iceServers: join.iceServers,
        bundlePolicy: "max-bundle",
      });
      pc.addTransceiver("audio", { direction: "recvonly" });
      const stream = new MediaStream();
      let unmuted = false;
      pc.ontrack = (ev) => {
        stream.addTrack(ev.track);
        try {
          ev.track.enabled = true;
        } catch {
          // ignore
        }
        ev.track.onunmute = () => {
          unmuted = true;
        };
      };

      type Inbound = {
        bytesReceived?: number;
        packetsReceived?: number;
        packetsLost?: number;
      };

      const out = await new Promise<{
        inbound: Inbound[];
        peak: number;
        avg: number;
        unmuted: boolean;
        trackMuted: boolean | undefined;
        recSize: number;
        ice: string;
      }>((resolve, reject) => {
        const sock = new WebSocket(
          `${ws}/livestreams/${post}?token=${encodeURIComponent(token)}`,
        );
        const timer = setTimeout(() => reject(new Error("timeout")), 20000);
        sock.onmessage = (ev) => {
          void (async () => {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              tracks?: Array<{ sessionId: string; trackName: string }>;
            };
            if (msg.type !== "track") return;
            const wanted = (msg.tracks ?? [])
              .filter((t) => t.sessionId !== join.sessionId)
              .map((t) => ({
                location: "remote" as const,
                trackName: t.trackName,
                sessionId: t.sessionId,
              }));
            if (!wanted.length) return;

            const add = (await (
              await fetch(
                `${api}/api/livestreams/realtime/${post}/add_track`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: token,
                    Origin: "https://otobanana.com",
                  },
                  body: JSON.stringify({
                    session_id: join.sessionId,
                    payload: { tracks: wanted },
                  }),
                },
              )
            ).json()) as {
              sessionDescription?: RTCSessionDescriptionInit;
              requiresImmediateRenegotiation?: boolean;
            };

            if (add.sessionDescription) {
              await pc.setRemoteDescription(add.sessionDescription);
              if (add.requiresImmediateRenegotiation) {
                const ans = await pc.createAnswer();
                await pc.setLocalDescription(ans);
                await fetch(
                  `${api}/api/livestreams/realtime/${post}/renegotiate`,
                  {
                    method: "PUT",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: token,
                      Origin: "https://otobanana.com",
                    },
                    body: JSON.stringify({
                      session_id: join.sessionId,
                      payload: {
                        sessionDescription: {
                          type: "answer",
                          sdp: pc.localDescription?.sdp ?? "",
                        },
                      },
                    }),
                  },
                );
              }
            }

            for (let i = 0; i < 40; i++) {
              await new Promise((r) => setTimeout(r, 250));
              const track = stream.getAudioTracks()[0];
              if (track && !track.muted) break;
            }

            // Wait a bit for RTP
            await new Promise((r) => setTimeout(r, 2000));
            const stats = await pc.getStats();
            const inbound: Inbound[] = [];
            stats.forEach((r) => {
              const rec = r as Record<string, unknown>;
              if (
                rec.type === "inbound-rtp" &&
                (rec.kind === "audio" || rec.mediaType === "audio")
              ) {
                inbound.push({
                  bytesReceived:
                    typeof rec.bytesReceived === "number"
                      ? rec.bytesReceived
                      : undefined,
                  packetsReceived:
                    typeof rec.packetsReceived === "number"
                      ? rec.packetsReceived
                      : undefined,
                  packetsLost:
                    typeof rec.packetsLost === "number"
                      ? rec.packetsLost
                      : undefined,
                });
              }
            });

            const AC =
              (
                window as unknown as {
                  AudioContext?: typeof AudioContext;
                  webkitAudioContext?: typeof AudioContext;
                }
              ).AudioContext ||
              (
                window as unknown as {
                  webkitAudioContext?: typeof AudioContext;
                }
              ).webkitAudioContext;
            if (!AC) throw new Error("no AudioContext");
            const ctx = new AC();
            await ctx.resume();
            const src = ctx.createMediaStreamSource(stream);
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            let peak = 0;
            let sum = 0;
            let n = 0;
            proc.onaudioprocess = (e) => {
              const d = e.inputBuffer.getChannelData(0);
              for (let i = 0; i < d.length; i++) {
                const a = Math.abs(d[i]!);
                if (a > peak) peak = a;
                sum += a;
                n++;
              }
            };
            const gain = ctx.createGain();
            gain.gain.value = 0;
            src.connect(proc);
            proc.connect(gain);
            gain.connect(ctx.destination);
            await new Promise((r) => setTimeout(r, 3000));

            let recSize = 0;
            try {
              const rec = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
              });
              rec.ondataavailable = (e) => {
                recSize += e.data ? e.data.size : 0;
              };
              rec.start(200);
              await new Promise((r) => setTimeout(r, 2500));
              await new Promise<void>((r) => {
                rec.onstop = () => r();
                rec.stop();
                setTimeout(() => r(), 500);
              });
            } catch {
              recSize = -1;
            }

            clearTimeout(timer);
            sock.close();
            const ice = pc.iceConnectionState;
            pc.close();
            await ctx.close();
            resolve({
              inbound,
              peak,
              avg: n ? sum / n : 0,
              unmuted,
              trackMuted: stream.getAudioTracks()[0]?.muted,
              recSize,
              ice,
            });
          })().catch(reject);
        };
      });

      return out;
    },
    { api: API, ws: WS, post, token },
  );

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
