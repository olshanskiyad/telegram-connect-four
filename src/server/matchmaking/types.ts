import type { RoomView } from "@/server/rooms/types";
import type { StoredProfile } from "@/server/profile/store";

export type MatchmakingStatus = "idle" | "waiting" | "matched";

export type MatchmakingEntry = {
  id: string;
  telegramId: number;
  profile: StoredProfile;
  status: MatchmakingStatus;
  joinedAt: string;
  updatedAt: string;
  matchedAt: string | null;
  roomId: string | null;
  roomInviteCode: string | null;
};

export type MatchmakingView = {
  status: MatchmakingStatus;
  queuePosition: number | null;
  waitingCount: number;
  joinedAt: string | null;
  matchedAt: string | null;
  room: RoomView | null;
};

