// Package main records Otobanana Cloudflare Realtime live audio without a browser.
// Protocol: join → track announce → add_track → renegotiate → Opus RTP → Ogg.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

const (
	defaultAPIBase = "https://api.v2.otobanana.com"
	defaultWSBase  = "wss://api.v3.otobanana.com/ws"
	defaultOrigin  = "https://otobanana.com"
	defaultUA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

	// Upstream Otobanana/CF sometimes returns empty 500 on add_track.
	maxAddTrackAttempts = 3
	maxJoinCycles       = 3 // initial join + re-join attempts
)

type iceServerJSON struct {
	URLs       any    `json:"urls"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

type joinResponse struct {
	SessionID string          `json:"sessionId"`
	IceServers []iceServerJSON `json:"iceServers"`
	Message   string          `json:"message"`
}

type sessionDescriptionJSON struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

type addTrackResponse struct {
	ErrorCode                     string                  `json:"errorCode"`
	ErrorDescription              string                  `json:"errorDescription"`
	SessionDescription            *sessionDescriptionJSON `json:"sessionDescription"`
	RequiresImmediateRenegotiation bool                   `json:"requiresImmediateRenegotiation"`
	Message                       string                  `json:"message"`
}

type wsTrack struct {
	SessionID string `json:"sessionId"`
	TrackName string `json:"trackName"`
}

type wsMessage struct {
	Type    string    `json:"type"`
	Tracks  []wsTrack `json:"tracks"`
	Message string    `json:"message"`
	Count   int       `json:"count"`
}

type httpStatusError struct {
	op     string
	status int
	body   string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("%s HTTP %d: %s", e.op, e.status, e.body)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	var (
		token     = flag.String("token", envOr("OTOBANANA_TOKEN", ""), "Bearer access token (or OTOBANANA_TOKEN)")
		email     = flag.String("email", envOr("OTOBANANA_EMAIL", ""), "login email if token empty")
		password  = flag.String("password", envOr("OTOBANANA_PASSWORD", ""), "login password if token empty")
		postPtrID = flag.String("post-ptr-id", "", "livestream post_ptr_id (required)")
		outPath   = flag.String("out", "audio.ogg", "output Opus/Ogg path")
		maxSec    = flag.Int("max-sec", 30, "max record duration seconds")
		apiBase   = flag.String("api-base", defaultAPIBase, "Otobanana API base")
		wsBase    = flag.String("ws-base", defaultWSBase, "Otobanana WS base")
		pickLive  = flag.Bool("pick-live", false, "auto-pick an open realtime room (needs auth)")
	)
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	auth := strings.TrimSpace(*token)
	if auth == "" {
		if strings.TrimSpace(*email) == "" || strings.TrimSpace(*password) == "" {
			log.Fatal("need -token or -email/-password (env OTOBANANA_*)")
		}
		t, err := signIn(*apiBase, *email, *password)
		if err != nil {
			log.Fatalf("signin: %v", err)
		}
		auth = t
		log.Printf("signed in")
	}
	if !strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		// API accepts raw accessToken in Authorization in browser path; keep as-is.
	}

	ptr := strings.TrimSpace(*postPtrID)
	if ptr == "" && *pickLive {
		room, err := pickOpenRealtimeRoom(*apiBase, auth)
		if err != nil {
			log.Fatalf("pick-live: %v", err)
		}
		ptr = room.PostPtrID
		log.Printf("picked room=%s post_ptr_id=%s title=%q listeners=%d", room.RoomID, ptr, room.Title, room.Listeners)
	}
	if ptr == "" {
		log.Fatal("need -post-ptr-id or -pick-live")
	}

	maxDur := time.Duration(*maxSec) * time.Second
	if maxDur <= 0 {
		maxDur = 30 * time.Second
	}

	if err := record(ctx, recordOpts{
		APIBase:   strings.TrimRight(*apiBase, "/"),
		WSBase:    strings.TrimRight(*wsBase, "/"),
		Token:     auth,
		PostPtrID: ptr,
		OutPath:   *outPath,
		MaxDur:    maxDur,
	}); err != nil {
		log.Fatalf("record: %v", err)
	}
	log.Printf("done out=%s", *outPath)
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func signIn(apiBase, email, password string) (string, error) {
	body := map[string]string{"Email": email, "Password": password}
	raw, status, err := httpJSON(context.Background(), http.MethodPost, apiBase+"/api/signin", "", body)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("HTTP %d: %s", status, truncate(string(raw), 300))
	}
	var parsed struct {
		AccessToken string `json:"accessToken"`
		Message     string `json:"message"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if parsed.AccessToken == "" {
		return "", fmt.Errorf("no accessToken: %s", truncate(string(raw), 300))
	}
	return parsed.AccessToken, nil
}

type liveRoom struct {
	RoomID    string
	PostPtrID string
	Title     string
	Listeners int
}

func pickOpenRealtimeRoom(apiBase, token string) (*liveRoom, error) {
	var best *liveRoom
	for _, adult := range []bool{true, false} {
		raw, status, err := httpJSON(context.Background(), http.MethodGet,
			fmt.Sprintf("%s/api/top/livestreams?is_adult=%v", apiBase, adult), token, nil)
		if err != nil {
			return nil, err
		}
		if status < 200 || status >= 300 {
			return nil, fmt.Errorf("list HTTP %d: %s", status, truncate(string(raw), 200))
		}
		var body struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, err
		}
		for _, r := range body.Data {
			if r["is_open"] != true {
				continue
			}
			if fmt.Sprint(r["stream_service"]) != "realtime" {
				continue
			}
			roomID, _ := r["room_id"].(string)
			postPtr, _ := r["post_ptr_id"].(string)
			if roomID == "" || postPtr == "" {
				continue
			}
			title := ""
			if post, ok := r["post"].(map[string]any); ok {
				if t, ok := post["title"].(string); ok {
					title = t
				}
			}
			listeners := 0
			switch v := r["listener_count"].(type) {
			case float64:
				listeners = int(v)
			case int:
				listeners = v
			}
			cand := &liveRoom{RoomID: roomID, PostPtrID: postPtr, Title: title, Listeners: listeners}
			if best == nil || cand.Listeners > best.Listeners {
				best = cand
			}
		}
	}
	if best == nil {
		return nil, errors.New("no open realtime room")
	}
	return best, nil
}

type recordOpts struct {
	APIBase   string
	WSBase    string
	Token     string
	PostPtrID string
	OutPath   string
	MaxDur    time.Duration
}

func joinRealtime(ctx context.Context, opts recordOpts) (joinResponse, error) {
	joinToken := uuid.NewString()
	joinRaw, status, err := httpJSON(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/livestreams/realtime/%s/join", opts.APIBase, url.PathEscape(opts.PostPtrID)),
		opts.Token,
		map[string]string{"livestream_join_token": joinToken},
	)
	if err != nil {
		return joinResponse{}, fmt.Errorf("join: %w", err)
	}
	if status < 200 || status >= 300 {
		return joinResponse{}, fmt.Errorf("join HTTP %d: %s", status, truncate(string(joinRaw), 400))
	}
	var join joinResponse
	if err := json.Unmarshal(joinRaw, &join); err != nil {
		return joinResponse{}, fmt.Errorf("join json: %w", err)
	}
	if join.SessionID == "" {
		return joinResponse{}, fmt.Errorf("join missing sessionId: %s", truncate(string(joinRaw), 400))
	}
	log.Printf("joined session=%s iceServers=%d", join.SessionID, len(join.IceServers))
	return join, nil
}

func isRetryableAddTrack(status int, err error) bool {
	if err != nil {
		return true
	}
	return status == 429 || status >= 500
}

// isEmptyTrackError reports CF/Otobanana ghost tracks with no media from the
// publisher. These must not end an otherwise healthy recording session.
func isEmptyTrackError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "empty_track_error") ||
		(strings.Contains(s, "missing sessionDescription") && strings.Contains(s, "empty_track"))
}

func backoffWait(ctx context.Context, attempt int) error {
	// attempt is 1-based after a failure: 1s, 2s, 4s
	d := time.Duration(1<<uint(attempt-1)) * time.Second
	if d > 8*time.Second {
		d = 8 * time.Second
	}
	log.Printf("backoff %s before retry", d)
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func record(ctx context.Context, opts recordOpts) error {
	join, err := joinRealtime(ctx, opts)
	if err != nil {
		return err
	}

	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return err
	}
	interceptorRegistry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry); err != nil {
		return err
	}
	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithInterceptorRegistry(interceptorRegistry),
	)

	var (
		pcMu sync.Mutex
		pc   *webrtc.PeerConnection
	)

	newPC := func(ice []iceServerJSON) (*webrtc.PeerConnection, error) {
		peer, err := api.NewPeerConnection(webrtc.Configuration{
			ICEServers:   toICEServers(ice),
			BundlePolicy: webrtc.BundlePolicyMaxBundle,
		})
		if err != nil {
			return nil, err
		}
		if _, err := peer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			_ = peer.Close()
			return nil, fmt.Errorf("add transceiver: %w", err)
		}
		return peer, nil
	}

	pc, err = newPC(join.IceServers)
	if err != nil {
		return err
	}
	defer func() {
		pcMu.Lock()
		cur := pc
		pcMu.Unlock()
		if cur != nil {
			_ = cur.Close()
		}
	}()

	ogg, err := oggwriter.New(opts.OutPath, 48000, 2)
	if err != nil {
		return fmt.Errorf("oggwriter: %w", err)
	}
	defer ogg.Close()

	var (
		bytesWritten int64
		pktCount     int64
		trackOnce    sync.Once
		trackDone    = make(chan struct{})
		writeMu      sync.Mutex
	)

	attachPCHandlers := func(peer *webrtc.PeerConnection) {
		peer.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
			codec := track.Codec()
			log.Printf("ontrack kind=%s codec=%s ssrc=%d", track.Kind().String(), codec.MimeType, track.SSRC())
			if track.Kind() != webrtc.RTPCodecTypeAudio {
				return
			}
			trackOnce.Do(func() {
				go func() {
					defer close(trackDone)
					for {
						pkt, _, readErr := track.ReadRTP()
						if readErr != nil {
							if !errors.Is(readErr, io.EOF) && !strings.Contains(readErr.Error(), "closed") {
								log.Printf("read rtp: %v", readErr)
							}
							return
						}
						writeMu.Lock()
						werr := ogg.WriteRTP(pkt)
						writeMu.Unlock()
						if werr != nil {
							log.Printf("write ogg: %v", werr)
							return
						}
						pktCount++
						bytesWritten += int64(len(pkt.Payload))
						if pktCount == 1 || pktCount%250 == 0 {
							log.Printf("rtp pkt=%d payload_bytes≈%d", pktCount, bytesWritten)
						}
					}
				}()
			})
		})
		peer.OnICEConnectionStateChange(func(s webrtc.ICEConnectionState) {
			log.Printf("ice=%s", s.String())
		})
		peer.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
			log.Printf("pc=%s", s.String())
		})
	}
	attachPCHandlers(pc)

	// Signaling WS + pull tracks.
	done := make(chan error, 1)
	wsURL := fmt.Sprintf("%s/livestreams/%s?token=%s",
		opts.WSBase, url.PathEscape(opts.PostPtrID), url.QueryEscape(opts.Token))

	dialer := websocket.Dialer{HandshakeTimeout: 30 * time.Second}
	header := http.Header{}
	header.Set("Origin", defaultOrigin)
	header.Set("User-Agent", defaultUA)
	conn, _, err := dialer.DialContext(ctx, wsURL, header)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()
	log.Printf("ws open")

	var pullMu sync.Mutex
	pulled := map[string]bool{}
	var joinMu sync.Mutex

	replacePC := func(ice []iceServerJSON) error {
		peer, err := newPC(ice)
		if err != nil {
			return err
		}
		attachPCHandlers(peer)
		pcMu.Lock()
		old := pc
		pc = peer
		pcMu.Unlock()
		if old != nil {
			_ = old.Close()
		}
		return nil
	}

	currentPC := func() *webrtc.PeerConnection {
		pcMu.Lock()
		defer pcMu.Unlock()
		return pc
	}

	currentSessionID := func() string {
		joinMu.Lock()
		defer joinMu.Unlock()
		return join.SessionID
	}

	rejoin := func() error {
		next, err := joinRealtime(ctx, opts)
		if err != nil {
			return err
		}
		if err := replacePC(next.IceServers); err != nil {
			return err
		}
		joinMu.Lock()
		join = next
		joinMu.Unlock()
		log.Printf("re-joined after add_track failure session=%s", next.SessionID)
		return nil
	}

	// One add_track HTTP + optional renegotiate against current session/PC.
	addTrackOnce := func(wanted []map[string]string) error {
		sessionID := currentSessionID()
		peer := currentPC()
		if peer == nil {
			return errors.New("peer connection is nil")
		}
		log.Printf("add_track n=%d session=%s", len(wanted), sessionID)
		raw, st, err := httpJSON(ctx, http.MethodPost,
			fmt.Sprintf("%s/api/livestreams/realtime/%s/add_track", opts.APIBase, url.PathEscape(opts.PostPtrID)),
			opts.Token,
			map[string]any{
				"session_id": sessionID,
				"payload":    map[string]any{"tracks": wanted},
			},
		)
		if err != nil {
			return fmt.Errorf("add_track transport: %w", err)
		}
		if st < 200 || st >= 300 {
			return &httpStatusError{
				op:     "add_track",
				status: st,
				body:   truncate(string(raw), 400),
			}
		}
		var add addTrackResponse
		if err := json.Unmarshal(raw, &add); err != nil {
			return err
		}
		if add.ErrorCode != "" {
			return fmt.Errorf("add_track: %s %s", add.ErrorCode, add.ErrorDescription)
		}
		if add.SessionDescription == nil || add.SessionDescription.SDP == "" {
			return fmt.Errorf("add_track missing sessionDescription: %s", truncate(string(raw), 300))
		}
		offer := webrtc.SessionDescription{
			Type: webrtc.NewSDPType(add.SessionDescription.Type),
			SDP:  add.SessionDescription.SDP,
		}
		if err := peer.SetRemoteDescription(offer); err != nil {
			return fmt.Errorf("set remote: %w", err)
		}
		if !add.RequiresImmediateRenegotiation {
			log.Printf("add_track ok (no renegotiate flag)")
			return nil
		}
		answer, err := peer.CreateAnswer(nil)
		if err != nil {
			return fmt.Errorf("create answer: %w", err)
		}
		gatherComplete := webrtc.GatheringCompletePromise(peer)
		if err := peer.SetLocalDescription(answer); err != nil {
			return fmt.Errorf("set local: %w", err)
		}
		select {
		case <-gatherComplete:
		case <-time.After(5 * time.Second):
			log.Printf("ice gather timeout; continuing")
		case <-ctx.Done():
			return ctx.Err()
		}
		local := peer.LocalDescription()
		if local == nil {
			return errors.New("nil local description")
		}
		renRaw, renSt, err := httpJSON(ctx, http.MethodPut,
			fmt.Sprintf("%s/api/livestreams/realtime/%s/renegotiate", opts.APIBase, url.PathEscape(opts.PostPtrID)),
			opts.Token,
			map[string]any{
				"session_id": sessionID,
				"payload": map[string]any{
					"sessionDescription": map[string]string{
						"type": "answer",
						"sdp":  local.SDP,
					},
				},
			},
		)
		if err != nil {
			return fmt.Errorf("renegotiate transport: %w", err)
		}
		if renSt < 200 || renSt >= 300 {
			return &httpStatusError{
				op:     "renegotiate",
				status: renSt,
				body:   truncate(string(renRaw), 400),
			}
		}
		log.Printf("renegotiate ok")
		return nil
	}

	// 5xx/transport: up to maxAddTrackAttempts with backoff; then re-join and try again.
	// Total join cycles (including the current session) capped at maxJoinCycles.
	pullTracksWithRetry := func(wanted []map[string]string) error {
		var lastErr error
		for cycle := 1; cycle <= maxJoinCycles; cycle++ {
			if cycle > 1 {
				log.Printf("add_track cycle=%d/%d re-join", cycle, maxJoinCycles)
				if err := rejoin(); err != nil {
					return fmt.Errorf("re-join: %w", err)
				}
			}
			for attempt := 1; attempt <= maxAddTrackAttempts; attempt++ {
				err := addTrackOnce(wanted)
				if err == nil {
					return nil
				}
				lastErr = err
				retryable := false
				var he *httpStatusError
				if errors.As(err, &he) {
					retryable = isRetryableAddTrack(he.status, nil)
				} else if strings.Contains(err.Error(), "transport:") {
					retryable = true
				}
				log.Printf("add_track cycle=%d attempt=%d/%d failed: %v", cycle, attempt, maxAddTrackAttempts, err)
				if !retryable {
					return err
				}
				if attempt < maxAddTrackAttempts {
					if err := backoffWait(ctx, attempt); err != nil {
						return err
					}
				}
			}
			log.Printf("add_track exhausted %d attempts on cycle=%d", maxAddTrackAttempts, cycle)
		}
		if lastErr == nil {
			lastErr = errors.New("add_track failed")
		}
		return fmt.Errorf("add_track failed after %d join cycles: %w", maxJoinCycles, lastErr)
	}

	pullTracks := func(tracks []wsTrack) error {
		pullMu.Lock()
		defer pullMu.Unlock()
		sessionID := currentSessionID()
		wanted := make([]map[string]string, 0, len(tracks))
		keys := make([]string, 0, len(tracks))
		for _, t := range tracks {
			if t.SessionID == "" || t.TrackName == "" || t.SessionID == sessionID {
				continue
			}
			key := t.SessionID + "|" + t.TrackName
			if pulled[key] {
				continue
			}
			keys = append(keys, key)
			wanted = append(wanted, map[string]string{
				"location":  "remote",
				"trackName": t.TrackName,
				"sessionId": t.SessionID,
			})
		}
		if len(wanted) == 0 {
			return nil
		}
		if err := pullTracksWithRetry(wanted); err != nil {
			if isEmptyTrackError(err) {
				// Ghost track: keep receiving existing RTP; do not mark pulled
				// so a later re-announce can retry the same key.
				names := make([]string, 0, len(wanted))
				for _, w := range wanted {
					names = append(names, w["trackName"])
				}
				log.Printf("ignore empty_track n=%d tracks=%v: %v", len(wanted), names, err)
				return nil
			}
			return err
		}
		// Mark pulled only after successful add_track + renegotiate.
		for _, key := range keys {
			pulled[key] = true
		}
		return nil
	}

	go func() {
		defer conn.Close()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				select {
				case done <- fmt.Errorf("ws read: %w", err):
				default:
				}
				return
			}
			var msg wsMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				log.Printf("ws bad json: %v", err)
				continue
			}
			switch msg.Type {
			case "track":
				if err := pullTracks(msg.Tracks); err != nil {
					select {
					case done <- err:
					default:
					}
					return
				}
			case "end":
				log.Printf("ws end")
				select {
				case done <- nil:
				default:
				}
				return
			case "error":
				select {
				case done <- fmt.Errorf("ws error: %s", msg.Message):
				default:
				}
				return
			case "ping":
				_ = conn.WriteJSON(map[string]string{"type": "ping"})
			case "participant":
				// high-churn; omit to keep logs readable
			default:
				// ignore
			}
		}
	}()

	deadline := time.NewTimer(opts.MaxDur)
	defer deadline.Stop()

	select {
	case <-ctx.Done():
		log.Printf("interrupted")
	case <-deadline.C:
		log.Printf("max duration reached")
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			// still keep partial file if any audio
			if pktCount == 0 {
				return err
			}
			log.Printf("stop with audio after error: %v", err)
		}
	case <-trackDone:
		log.Printf("track ended")
	}

	// give a moment for in-flight RTP
	select {
	case <-time.After(500 * time.Millisecond):
	case <-ctx.Done():
	}

	if pktCount == 0 {
		return errors.New("no RTP packets recorded (join/ws/add_track may have failed silently)")
	}
	log.Printf("finished packets=%d payload_bytes≈%d", pktCount, bytesWritten)
	return nil
}

func toICEServers(in []iceServerJSON) []webrtc.ICEServer {
	if len(in) == 0 {
		return []webrtc.ICEServer{{URLs: []string{"stun:stun.cloudflare.com:3478"}}}
	}
	out := make([]webrtc.ICEServer, 0, len(in))
	for _, s := range in {
		urls := normalizeURLs(s.URLs)
		if len(urls) == 0 {
			continue
		}
		out = append(out, webrtc.ICEServer{
			URLs:       urls,
			Username:   s.Username,
			Credential: s.Credential,
		})
	}
	if len(out) == 0 {
		return []webrtc.ICEServer{{URLs: []string{"stun:stun.cloudflare.com:3478"}}}
	}
	return out
}

func normalizeURLs(v any) []string {
	switch t := v.(type) {
	case string:
		if t == "" {
			return nil
		}
		return []string{t}
	case []any:
		var out []string
		for _, item := range t {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return t
	default:
		return nil
	}
}

func httpJSON(ctx context.Context, method, rawURL, token string, body any) ([]byte, int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		rdr = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rdr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Origin", defaultOrigin)
	req.Header.Set("Referer", defaultOrigin+"/")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, res.StatusCode, err
	}
	return data, res.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
