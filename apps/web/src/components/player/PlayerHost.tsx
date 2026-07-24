import { usePlayer } from "../../player/PlayerContext";
import { FloatingPlayerCard } from "./FloatingPlayerCard";
import { PlayerSheet } from "./PlayerSheet";
import { useIsDesktop } from "./useIsDesktop";

export function PlayerHost() {
  const { track } = usePlayer();
  const isDesktop = useIsDesktop(900);

  if (!track) return null;

  return isDesktop ? <FloatingPlayerCard /> : <PlayerSheet />;
}
