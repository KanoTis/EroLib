import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { WorkCover } from "../components/WorkCover";
import { IconBack, IconRefresh } from "../components/Icons";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载",
  queued: "队列中",
  downloading: "下载中",
  failed: "失败",
  discovered: "已发现",
};

export function WorkDetailPage() {
  const { provider = "", workId = "" } = useParams();
  const [work, setWork] = useState<WorkPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(): Promise<void> {
    try {
      setError(null);
      setWork(await api.work(provider, workId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [provider, workId]);

  if (error && !work) {
    return (
      <div className="page">
        <Link className="back-link" to="/">
          <IconBack width={16} height={16} />
          返回媒体库
        </Link>
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="page">
        <div className="loading-block" role="status">
          <span className="spinner" />
          加载作品详情…
        </div>
      </div>
    );
  }

  const busy = work.status === "queued" || work.status === "downloading";

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <IconBack width={16} height={16} />
        返回媒体库
      </Link>

      <section className="card">
        <div className="detail-hero">
          <WorkCover
            provider={work.provider}
            workId={work.workId}
            title={work.title}
            authorName={work.authorName}
            coverPath={work.coverPath}
            size="detail"
          />
          <div>
            <p className="page-kicker">{work.provider}</p>
            <h1 className="detail-title">{work.title}</h1>
            <div className="row" style={{ marginBottom: "1rem" }}>
              <span className={`badge ${work.status}`}>
                {STATUS_LABEL[work.status] ?? work.status}
              </span>
              <span className="badge soft">
                远端收藏：{work.remoteInFavorites ? "是" : "否"}
              </span>
            </div>
            <dl className="meta">
              <div>
                <dt>作者</dt>
                <dd>{work.authorName ?? work.authorId ?? "—"}</dd>
              </div>
              <div>
                <dt>Work ID</dt>
                <dd>{work.workId}</dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>
                  {work.durationSeconds != null
                    ? `${Math.floor(work.durationSeconds / 60)}:${String(
                        work.durationSeconds % 60,
                      ).padStart(2, "0")}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{work.provider}</dd>
              </div>
              {work.sourceUrl ? (
                <div>
                  <dt>原始链接</dt>
                  <dd>
                    <a href={work.sourceUrl} target="_blank" rel="noreferrer">
                      打开源站
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            {work.description ? <p className="desc">{work.description}</p> : null}
          </div>
        </div>

        <div className="alert-stack" style={{ marginTop: "1rem" }}>
          {work.error ? (
            <p className="error" role="alert">
              {work.error}
            </p>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {msg ? (
            <p className="ok" role="status">
              {msg}
            </p>
          ) : null}
        </div>

        {work.status === "downloaded" ? (
          <div className="detail-player">
            <strong>本地播放</strong>
            <audio controls src={api.audioUrl(work.provider, work.workId)} />
          </div>
        ) : (
          <p className="muted" style={{ marginTop: "1rem" }}>
            仅下载完成后可播放。当前状态：
            {STATUS_LABEL[work.status] ?? work.status}
          </p>
        )}

        <div className="form-actions" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="secondary"
            disabled={refreshing || busy}
            onClick={() => {
              setRefreshing(true);
              setMsg(null);
              setError(null);
              void api
                .refreshMetadata(work.provider, work.workId)
                .then((r) => {
                  setMsg(
                    r.warning
                      ? `元数据已刷新（${r.warning}）`
                      : "元数据已刷新",
                  );
                  return load();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? (
              <span className="spinner" />
            ) : (
              <IconRefresh width={16} height={16} />
            )}
            刷新元数据
          </button>
          <button
            type="button"
            className="secondary"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setMsg(null);
              setError(null);
              void api
                .retryWork(work.provider, work.workId)
                .then(() => {
                  setMsg("已重新入队下载");
                  return load();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setRetrying(false));
            }}
          >
            {retrying ? (
              <span className="spinner" />
            ) : (
              <IconRefresh width={16} height={16} />
            )}
            重试下载
          </button>
        </div>
      </section>
    </div>
  );
}
