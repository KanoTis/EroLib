/**
 * Injected into Chromium via page.evaluate(script, args).
 * Must stay plain JS (no TypeScript / no bundler helpers).
 *
 * Captures remote WebRTC audio via MediaStreamTrackProcessor (AudioData),
 * falling back to AudioContext ScriptProcessor.
 * Node side assembles a WAV file from int16 mono PCM.
 *
 * @param {{ apiBase: string, wsBase: string, postPtrId: string, token: string, maxMs: number }} args
 */
export async function browserRecordMain(args) {
  const { apiBase, wsBase, postPtrId, token, maxMs } = args;
  const g = globalThis;

  const isRecord = (value) => typeof value === "object" && value !== null;

  const parseJoin = (raw) => {
    if (!isRecord(raw)) return {};
    return {
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
      iceServers: Array.isArray(raw.iceServers) ? raw.iceServers : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  };

  const parseAddTrack = (raw) => {
    if (!isRecord(raw)) return {};
    const sd = isRecord(raw.sessionDescription)
      ? {
          type:
            typeof raw.sessionDescription.type === "string"
              ? raw.sessionDescription.type
              : undefined,
          sdp:
            typeof raw.sessionDescription.sdp === "string"
              ? raw.sessionDescription.sdp
              : undefined,
        }
      : undefined;
    return {
      errorCode: typeof raw.errorCode === "string" ? raw.errorCode : undefined,
      errorDescription:
        typeof raw.errorDescription === "string"
          ? raw.errorDescription
          : undefined,
      sessionDescription: sd,
      requiresImmediateRenegotiation:
        raw.requiresImmediateRenegotiation === true,
    };
  };

  const parseWs = (raw) => {
    if (!isRecord(raw)) return {};
    const tracks = [];
    if (Array.isArray(raw.tracks)) {
      for (const item of raw.tracks) {
        if (!isRecord(item)) continue;
        if (
          typeof item.sessionId === "string" &&
          typeof item.trackName === "string"
        ) {
          tracks.push({
            sessionId: item.sessionId,
            trackName: item.trackName,
          });
        }
      }
    }
    return {
      type: typeof raw.type === "string" ? raw.type : undefined,
      tracks: tracks.length > 0 ? tracks : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  };

  let pc = null;
  let ws = null;
  let stopped = false;
  let captureStop = null;
  let chunkCount = 0;
  let peak = 0;
  const remoteStream = new g.MediaStream();

  const appendBytes = async (u8) => {
    if (typeof g.__erolibAppend !== "function") {
      g.__erolibLog("__erolibAppend missing");
      return;
    }
    await g.__erolibAppend(Array.from(u8));
    chunkCount += 1;
    if (chunkCount === 1 || chunkCount % 50 === 0) {
      g.__erolibLog(`pcm chunk#${chunkCount} bytes=${u8.length} peak=${peak.toFixed(5)}`);
    }
  };

  const floatTo16 = (float32) => {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      let s = float32[i];
      const a = Math.abs(s);
      if (a > peak) peak = a;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return new Uint8Array(out.buffer);
  };

  const stopAll = async (reason) => {
    if (stopped) return;
    stopped = true;
    g.__erolibLog(`stop: ${reason} chunks=${chunkCount} peak=${peak}`);
    try {
      if (typeof captureStop === "function") await captureStop();
    } catch {
      // ignore
    }
    try {
      ws?.close();
    } catch {
      // ignore
    }
    try {
      pc?.close();
    } catch {
      // ignore
    }
    g.__erolibDone = reason;
  };
  g.__erolibStop = () => stopAll("external-stop");

  const startTrackProcessorCapture = async (track) => {
    if (typeof g.MediaStreamTrackProcessor !== "function") {
      g.__erolibLog("MediaStreamTrackProcessor unavailable");
      return false;
    }
    const processor = new g.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    let running = true;
    captureStop = async () => {
      running = false;
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    };

    // Read first frame for sample rate
    const first = await reader.read();
    if (first.done || !first.value) {
      g.__erolibLog("TrackProcessor no first frame");
      return false;
    }
    const firstFrame = first.value;
    const rate = firstFrame.sampleRate || 48000;
    const channels = firstFrame.numberOfChannels || 1;
    if (typeof g.__erolibSampleRate === "function") {
      await g.__erolibSampleRate(rate);
    }
    g.__erolibLog(
      `TrackProcessor started rate=${rate} ch=${channels} frames=${firstFrame.numberOfFrames}`,
    );

    const handleFrame = async (frame) => {
      try {
        const frames = frame.numberOfFrames;
        const ch = frame.numberOfChannels || 1;
        // Downmix to mono float32
        const mono = new Float32Array(frames);
        if (ch === 1) {
          frame.copyTo(mono, { planeIndex: 0, format: "f32-planar" });
        } else {
          const plane0 = new Float32Array(frames);
          const plane1 = new Float32Array(frames);
          frame.copyTo(plane0, { planeIndex: 0, format: "f32-planar" });
          try {
            frame.copyTo(plane1, { planeIndex: 1, format: "f32-planar" });
          } catch {
            plane1.fill(0);
          }
          for (let i = 0; i < frames; i++) {
            mono[i] = (plane0[i] + plane1[i]) / 2;
          }
        }
        await appendBytes(floatTo16(mono));
      } finally {
        try {
          frame.close();
        } catch {
          // ignore
        }
      }
    };

    await handleFrame(firstFrame);

    void (async () => {
      while (running && !stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) await handleFrame(value);
      }
    })();
    return true;
  };

  const startAudioContextCapture = async (stream) => {
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) {
      g.__erolibLog("AudioContext unavailable");
      return false;
    }
    const audioCtx = new AC({ sampleRate: 48000 });
    try {
      await audioCtx.resume();
    } catch {
      // ignore
    }
    if (typeof g.__erolibSampleRate === "function") {
      await g.__erolibSampleRate(audioCtx.sampleRate || 48000);
    }
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);

    // Also destination through silent gain to keep graph active
    const silenceGain = audioCtx.createGain();
    silenceGain.gain.value = 0;
    sourceNode.connect(silenceGain);
    silenceGain.connect(audioCtx.destination);

    // Prefer AudioWorklet-less path: MediaStreamDestination + MediaRecorder is silent in tests.
    // Use ScriptProcessor if present.
    let processor = null;
    if (typeof audioCtx.createScriptProcessor === "function") {
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (ev) => {
        if (stopped) return;
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        void appendBytes(floatTo16(copy));
      };
      sourceNode.connect(processor);
      processor.connect(silenceGain);
    }

    // Poll analyser as heartbeat / secondary capture of time domain
    const timeData = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(timeData);
      let localPeak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const a = Math.abs(timeData[i]);
        if (a > localPeak) localPeak = a;
      }
      if (localPeak > peak) peak = localPeak;
      // If ScriptProcessor not producing, still dump analyser windows occasionally
      if (!processor) {
        void appendBytes(floatTo16(timeData));
      }
    }, 50);

    captureStop = async () => {
      clearInterval(timer);
      try {
        processor?.disconnect();
      } catch {
        // ignore
      }
      try {
        sourceNode.disconnect();
      } catch {
        // ignore
      }
      try {
        silenceGain.disconnect();
      } catch {
        // ignore
      }
      try {
        await audioCtx.close();
      } catch {
        // ignore
      }
    };

    g.__erolibLog(
      `AudioContext capture started rate=${audioCtx.sampleRate} hasScriptProcessor=${!!processor}`,
    );
    return true;
  };

  const startCapture = async () => {
    if (captureStop) return;
    const track = remoteStream.getAudioTracks()[0];
    if (!track) return;
    g.__erolibLog(
      `startCapture muted=${track.muted} enabled=${track.enabled} state=${track.readyState}`,
    );

    // Keep an audio element attached (helps some Chromium media paths).
    try {
      const audio = g.document?.createElement?.("audio");
      if (audio) {
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.volume = 0.001;
        audio.srcObject = remoteStream;
        void audio.play?.().catch((e) =>
          g.__erolibLog(`audio.play fail ${e?.message || e}`),
        );
        g.__erolibAudioEl = audio;
      }
    } catch {
      // ignore
    }

    let ok = false;
    try {
      ok = await startTrackProcessorCapture(track);
    } catch (err) {
      g.__erolibLog(
        `TrackProcessor failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!ok) {
      try {
        ok = await startAudioContextCapture(remoteStream);
      } catch (err) {
        g.__erolibLog(
          `AudioContext failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!ok) {
      g.__erolibError = "No audio capture backend available";
      await stopAll("error");
    }
  };

  const makeJoinToken = () => {
    if (g.crypto && typeof g.crypto.randomUUID === "function") {
      return g.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  try {
    const joinToken = makeJoinToken();
    const joinRes = await g.fetch(
      `${apiBase}/api/livestreams/realtime/${postPtrId}/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          Accept: "application/json",
          Origin: "https://otobanana.com",
        },
        body: JSON.stringify({ livestream_join_token: joinToken }),
      },
    );
    const join = parseJoin(await joinRes.json());
    if (!joinRes.ok || !join.sessionId) {
      throw new Error(join.message || `join failed HTTP ${joinRes.status}`);
    }
    const viewerSessionId = join.sessionId;
    g.__erolibLog(`joined session=${viewerSessionId}`);

    pc = new g.RTCPeerConnection({
      iceServers: join.iceServers ?? [
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      bundlePolicy: "max-bundle",
    });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      g.__erolibLog(
        `ontrack kind=${ev.track.kind} id=${ev.track.id} state=${ev.track.readyState} muted=${ev.track.muted}`,
      );
      try {
        ev.track.enabled = true;
      } catch {
        // ignore
      }
      remoteStream.addTrack(ev.track);
      const kick = () => {
        g.__erolibLog(
          `track ready muted=${ev.track.muted} enabled=${ev.track.enabled} state=${ev.track.readyState}`,
        );
        void startCapture();
      };
      if (!ev.track.muted) {
        kick();
      } else {
        ev.track.onunmute = () => {
          g.__erolibLog("track onunmute");
          kick();
        };
        let tries = 0;
        const poll = setInterval(() => {
          tries += 1;
          if (!ev.track.muted || tries > 40) {
            clearInterval(poll);
            kick();
          }
        }, 250);
      }
    };

    const pullTracks = async (tracks) => {
      if (!pc || stopped) return;
      const wanted = tracks.filter((t) => t.sessionId !== viewerSessionId);
      if (!wanted.length) return;
      const addRes = await g.fetch(
        `${apiBase}/api/livestreams/realtime/${postPtrId}/add_track`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
            Accept: "application/json",
            Origin: "https://otobanana.com",
          },
          body: JSON.stringify({
            session_id: viewerSessionId,
            payload: {
              tracks: wanted.map((t) => ({
                location: "remote",
                trackName: t.trackName,
                sessionId: t.sessionId,
              })),
            },
          }),
        },
      );
      const addBody = parseAddTrack(await addRes.json());
      if (!addRes.ok || addBody.errorCode) {
        throw new Error(
          addBody.errorDescription ||
            addBody.errorCode ||
            `add_track HTTP ${addRes.status}`,
        );
      }
      if (addBody.sessionDescription) {
        await pc.setRemoteDescription(addBody.sessionDescription);
        if (addBody.requiresImmediateRenegotiation) {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await new Promise((resolve) => {
            if (pc.iceGatheringState === "complete") return resolve();
            const t = setTimeout(resolve, 3000);
            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === "complete") {
                clearTimeout(t);
                resolve();
              }
            };
          });
          const ren = await g.fetch(
            `${apiBase}/api/livestreams/realtime/${postPtrId}/renegotiate`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: token,
                Accept: "application/json",
                Origin: "https://otobanana.com",
              },
              body: JSON.stringify({
                session_id: viewerSessionId,
                payload: {
                  sessionDescription: {
                    type: "answer",
                    sdp: pc.localDescription?.sdp ?? "",
                  },
                },
              }),
            },
          );
          if (!ren.ok) {
            const txt = await ren.text();
            throw new Error(`renegotiate HTTP ${ren.status}: ${txt}`);
          }
          g.__erolibLog("renegotiate ok");
        }
      }
    };

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void stopAll("max-duration").then(() => resolve());
      }, maxMs);

      ws = new g.WebSocket(
        `${wsBase}/livestreams/${postPtrId}?token=${encodeURIComponent(token)}`,
      );
      ws.onopen = () => g.__erolibLog("ws open");
      ws.onerror = () => {
        if (!stopped) g.__erolibError = "WebSocket error";
      };
      ws.onclose = () => {
        g.__erolibLog("ws close");
        if (!stopped) {
          clearTimeout(timer);
          void stopAll("ws-close").then(() => resolve());
        }
      };
      ws.onmessage = (ev) => {
        void (async () => {
          try {
            const parsed =
              typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
            const msg = parseWs(parsed);
            if (msg.type === "track" && msg.tracks?.length) {
              await pullTracks(msg.tracks);
            } else if (msg.type === "end") {
              clearTimeout(timer);
              await stopAll("stream-end");
              resolve();
            } else if (msg.type === "error") {
              clearTimeout(timer);
              g.__erolibError = msg.message || "ws error message";
              await stopAll("ws-error");
              reject(new Error(g.__erolibError));
            } else if (msg.type === "ping") {
              try {
                ws?.send(JSON.stringify({ type: "ping" }));
              } catch {
                // ignore
              }
            }
          } catch (err) {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      };
    });
  } catch (err) {
    g.__erolibError = err instanceof Error ? err.message : String(err);
    await stopAll("error");
    throw err;
  }
}

export function browserReadStatus() {
  const g = globalThis;
  return {
    done: g.__erolibDone ?? null,
    error: g.__erolibError ?? null,
  };
}

export async function browserRequestStop() {
  const g = globalThis;
  if (typeof g.__erolibStop === "function") {
    await g.__erolibStop();
  }
}
