import { IconVolume, IconVolumeMute } from "../Icons";
import { usePlayer } from "../../player/PlayerContext";

type PlayerVolumeProps = {
  className?: string;
  compact?: boolean;
};

export function PlayerVolume({
  className = "",
  compact = false,
}: PlayerVolumeProps) {
  const { volume, muted, setVolume, setMuted } = usePlayer();

  return (
    <div className={`player-volume ${compact ? "player-volume--compact" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="ghost icon-btn"
        aria-label={muted || volume === 0 ? "取消静音" : "静音"}
        onClick={() => setMuted(!(muted || volume === 0))}
      >
        {muted || volume === 0 ? (
          <IconVolumeMute width={18} height={18} />
        ) : (
          <IconVolume width={18} height={18} />
        )}
      </button>
      <label className="player-volume-label">
        <span className="sr-only">音量</span>
        <input
          className="player-volume-range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={muted || volume === 0 ? 0 : volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            if (v > 0 && muted) setMuted(false);
          }}
        />
      </label>
      {!compact ? (
        <button
          type="button"
          className="ghost icon-btn"
          aria-label="最大音量"
          onClick={() => {
            setVolume(1);
            if (muted) setMuted(false);
          }}
        >
          <IconVolume width={18} height={18} />
        </button>
      ) : null}
    </div>
  );
}
