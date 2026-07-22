# Erolib — セルフホスト音声メディアバックアップライブラリ

[English](README.md) | [中文](README.zh-CN.md) | **日本語**

Docker によるセルフホスト：**Otobanana / Koe-koe / Erovoice** のお気に入りをローカルへ同期し、ブラウザで閲覧・再生。**Otobanana のライブ購読と録画**に対応。

## 機能

| モジュール | 説明 |
|------|------|
| Providers | 3 サイトのアカウント設定（パスワードまたは Cookie）。資格情報は AES 暗号化して保存 |
| 同期 | 定時 / 手動でお気に入り一覧を取得し、ダウンロードをキュー投入 |
| ライブラリ | ローカル作品一覧（ページング）、詳細、カバーと音声再生；メタデータ更新可 |
| ダウンロードジョブ | キュー状態の確認；失敗は作品詳細から再試行 |
| ライブ | Otobanana フォロー中の配信、履歴配信者、購読録画、再生 |
| 設定 | 同期間隔などの実行パラメータ（保存後に新間隔で再スケジュール） |
| 認証 | 任意のローカルログイン（`AUTH_PASSWORD` が非空で有効） |

グローバル下部プレイヤー：ライブラリ作品とライブリプレイで共有、ルート切替でも再生継続。

リモートでお気に入り解除しても**ローカルファイルは削除されず**、「リモートお気に入り=いいえ」とマークされるだけです。

## クイックスタート（Docker）

```bash
# 1. docker-compose.yml を編集
#    - CREDENTIALS_SECRET：必須、16 文字以上のランダム文字列（サンプル値を使わない）
#    - AUTH_PASSWORD：任意；非空でログイン有効（AUTH_USERNAME 既定は admin）

# 2. GHCR パッケージが private の場合は先にログイン（token に read:packages が必要）
# echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

docker compose pull
docker compose up -d
curl -sS http://localhost:8080/api/health
# ブラウザで http://localhost:8080 を開く
```

- 既定イメージ：`ghcr.io/kanotis/erolib:latest`（GitHub Actions でビルド・プッシュ）
- ソースからビルド：`docker-compose.yml` で `build: .`（任意で `image: erolib:local`）、その後 `docker compose up -d --build`
- Compose は `init: true`（子プロセス回収）；イメージには Go `live-record` と **BtbN 静的 GPL ffmpeg**（`libmp3lame` 付き、apt フルスタックではない）を同梱

### ボリュームマウント

| コンテナパス | ホスト例 | 説明 |
|---------|-----------|------|
| `/data` | `./data` | SQLite `app.db`、セッションなど |
| `/media` | `./media` | 完了バックアップ：`{provider}/{authorId}/{workId}/`；ライブ：`{provider}/live/...` |
| `/cache` | `./cache` | ダウンロード一時ファイル（削除可） |

### 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | 待ち受けアドレス |
| `AUTH_USERNAME` | `admin` | ログインユーザー名 |
| `AUTH_PASSWORD` | 空 | 空で**認証オフ**；公開ネットに晒さない |
| `CREDENTIALS_SECRET` | （開発用の弱い既定） | Provider 資格情報の暗号化、**≥16 文字**；本番では必ず変更 |
| `DATA_DIR` / `MEDIA_DIR` / `CACHE_DIR` | `/data` など | データとメディアのパス |
| `SYNC_INTERVAL_HOURS` | `4` | 自動同期間隔（時間） |
| `MAX_DOWNLOAD_CONCURRENCY` | `2` | VOD ダウンロード同時実行数 |
| `WEB_DIST_DIR` | イメージ内 `/app/web/dist` | 静的フロントエンドディレクトリ |
| `FFMPEG_PATH` | Docker 既定 `/usr/local/bin/ffmpeg` | ローカルで上書き可；イメージは BtbN `linux64-gpl` 静的ビルド |
| `LIVE_RECORDER_BIN` | （任意） | Go `live-record` のパス；Docker 既定 `/usr/local/bin/live-record` |
| `NODE_ENV` | 本番イメージは `production` | 実行環境 |

読み込みロジックの詳細：`apps/server/src/config.ts`（`FFMPEG_PATH` は `providers/ffmpeg.ts` が参照）。

## 利用フロー

1. **Providers**：Otobanana / Koe-koe / Erovoice を追加（パスワードまたは Cookie）→ **テスト** ログイン  
2. **同期**：「今すぐ同期」を押す、または定時同期に任せる  
3. **ダウンロードジョブ**：キューを確認；失敗は作品詳細から再試行  
4. **ライブラリ**：状態が `downloaded` の作品のみ再生可；検索 / 絞り込み / さらに読み込み  
5. **ライブ**（Otobanana）：フォロー履歴の同期 / 配信確認 → 購読 → 自動録画 → ライブページまたはライブラリでリプレイ再生  
6. **設定**：同期間隔を調整

### サイト別の注意

| サイト | 説明 |
|------|------|
| Otobanana | VOD お気に入り同期とダウンロード；ライブ購読と録画 |
| Koe-koe | お気に入りページ解析と音声ダウンロード |
| Erovoice | サイト HLS（約 75kbps AAC）→ サーバー側で復号・変換して `audio.mp3`；**ffmpeg** が必要 |

**ライブ録画（native のみ）**：Go/pion バイナリ `apps/live-record` のみ使用。Docker イメージは `/usr/local/bin/live-record` を同梱。ローカル：

```bash
cd apps/live-record && go build -o live-record.exe .
# 任意：set LIVE_RECORDER_BIN=... で検索パスを上書き
```

## ローカル開発

要件：

- Node.js **≥ 20**（Docker イメージは Node 22）
- pnpm **10**（ルートの `packageManager` 参照）
- ローカル **ffmpeg**（Erovoice のダウンロード / 変換；`PATH` 上または `FFMPEG_PATH`）
- ライブ録画：**Go ≥ 1.22** で `apps/live-record` をビルド（または `LIVE_RECORDER_BIN`）

```bash
pnpm install
pnpm --filter @erolib/shared build
pnpm dev:server   # :8080
pnpm dev:web      # :5173、/api は 8080 へプロキシ
# または
pnpm dev          # server + web を並列
```

ディレクトリ系の環境変数未設定時は、カレント作業ディレクトリ下の `./data`、`./media`、`./cache` を使用。開発では既定の `CREDENTIALS_SECRET` のままで可；本番では必ず上書き。

ビルドとテスト：

```bash
pnpm build
pnpm test         # server 単体テスト
pnpm typecheck
pnpm start        # 本番モードで server 起動（先に build）
```

## プロジェクト構成

```
apps/server         Hono API · ジョブスケジューリング · Providers · ライブ録画 · SQLite
apps/live-record    Go/pion ブラウザレスライブ録画（Otobanana Realtime → Opus/Ogg）
apps/web            React SPA（ライブラリ / Providers / 同期 / ジョブ / ライブ / 設定）
packages/shared     共有型と契約
```

## セキュリティ注意

- `AUTH_PASSWORD` 未設定時、ポートに届く誰でも操作可能 — **ローカルまたは信頼できる LAN のみ**
- `CREDENTIALS_SECRET` は必ず変更し、実シークレットをリポジトリにコミットしない
- Provider 資格情報は暗号化保存；アカウント紐付け削除でもダウンロード済みメディアは残る
- 実アカウントを含む `./data` をバージョン管理に入れない

## トラブルシューティング

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| イメージ pull 401 / denied | GHCR private で未ログイン | `docker login ghcr.io`、token に `read:packages` |
| `/api/health` 不通 | コンテナ未起動またはポート占有 | `docker compose ps` / `logs`；`8080` マッピング確認 |
| Erovoice ダウンロード失敗で ffmpeg 言及 | ローカルに ffmpeg なし | ffmpeg インストールまたは `FFMPEG_PATH`；Docker イメージには同梱済み |
| ライブ録画 `live-record binary not found` | pion バイナリ未ビルド | `cd apps/live-record && go build`、または `LIVE_RECORDER_BIN` |
| `SYNC_INTERVAL_HOURS` 変更が効かない | 間隔は**設定ページ / DB 設定**優先 | Web **設定**で保存；compose 環境変数は初回/既定向けが多い |
| ログイン直後に切断 / Cookie 異常 | リバースプロキシが Cookie 未転送または HTTPS 設定 | 同一オリジン、またはプロキシを正しく設定；session cookie は httpOnly |

## 技術スタック（概要）

- バックエンド：Hono、Drizzle、libSQL/SQLite、Zod、ffmpeg  
- ライブ：Go + pion WebRTC（`apps/live-record`）  
- フロントエンド：React 19、React Router 7、Vite 6  
- デプロイ：Docker multi-stage（Node 22 + `pnpm deploy --prod` + live-record + BtbN 静的 ffmpeg）、GHCR `ghcr.io/kanotis/erolib`
