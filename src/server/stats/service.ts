import { listProfiles } from "@/server/profile/store";
import { listStoredRooms } from "@/server/rooms/store";
import type { StoredRoom } from "@/server/rooms/types";

import { getRoomGuestColor, getRoomHostColor } from "@/server/rooms/colors";
import { readStatsStore, updateStatsStore } from "./store";
import type {
  RatingLeaderboardResponse,
  RatingRow,
  RatingSummary,
  StoredUserStats,
  StatsStore
} from "./types";

function ensureStatsUser(store: Record<string, StoredUserStats>, telegramId: number, now: string): StoredUserStats {
  const existing = store[String(telegramId)];

  if (existing) {
    return existing;
  }

  const next: StoredUserStats = {
    telegramId,
    wins: 0,
    losses: 0,
    draws: 0,
    gamesPlayed: 0,
    lastMatchAt: null,
    updatedAt: now
  };

  store[String(telegramId)] = next;
  return next;
}

function touchUser(
  store: Record<string, StoredUserStats>,
  telegramId: number,
  patch: Partial<Pick<StoredUserStats, "wins" | "losses" | "draws" | "gamesPlayed">>,
  now: string
): StoredUserStats {
  const next = ensureStatsUser(store, telegramId, now);

  next.wins += patch.wins ?? 0;
  next.losses += patch.losses ?? 0;
  next.draws += patch.draws ?? 0;
  next.gamesPlayed += patch.gamesPlayed ?? 0;
  next.lastMatchAt = now;
  next.updatedAt = now;

  return next;
}

function compareRows(left: RatingRow, right: RatingRow): number {
  if (left.wins !== right.wins) {
    return right.wins - left.wins;
  }

  if (left.draws !== right.draws) {
    return right.draws - left.draws;
  }

  if (left.losses !== right.losses) {
    return left.losses - right.losses;
  }

  if (left.gamesPlayed !== right.gamesPlayed) {
    return right.gamesPlayed - left.gamesPlayed;
  }

  if (left.lastMatchAt && right.lastMatchAt && left.lastMatchAt !== right.lastMatchAt) {
    return right.lastMatchAt.localeCompare(left.lastMatchAt);
  }

  return left.nickname.localeCompare(right.nickname, "ru");
}

function roomOutcomeTimestamp(room: StoredRoom): string {
  return room.finishedAt ?? room.updatedAt ?? new Date().toISOString();
}

function roomResultKey(room: StoredRoom): string {
  return room.currentMatchId || room.id;
}

/** Counts a finished room once. Returns true if it was counted now, false if it was already counted (nothing is written). */
export async function recordRoomResult(room: StoredRoom): Promise<boolean> {
  const hostColor = getRoomHostColor(room);
  const guestColor = getRoomGuestColor(room);

  if (room.status !== "finished" || !room.result || !room.guest || !hostColor || !guestColor) {
    return false;
  }

  const host = room.host;
  const guest = room.guest;
  const recordedAt = roomOutcomeTimestamp(room);
  const result = room.result;
  const resultKey = roomResultKey(room);

  const updated = await updateStatsStore((store) => {
    if (store.appliedRooms[resultKey]) {
      return null;
    }

    if (result.kind === "draw") {
      touchUser(store.users, host.telegramId, { draws: 1, gamesPlayed: 1 }, recordedAt);
      touchUser(store.users, guest.telegramId, { draws: 1, gamesPlayed: 1 }, recordedAt);
    } else {
      const winner = hostColor === result.winner ? host : guest;
      const loser = winner.telegramId === host.telegramId ? guest : host;

      touchUser(store.users, winner.telegramId, { wins: 1, gamesPlayed: 1 }, recordedAt);
      touchUser(store.users, loser.telegramId, { losses: 1, gamesPlayed: 1 }, recordedAt);
    }

    store.appliedRooms[resultKey] = {
      roomId: resultKey,
      recordedAt,
      resultKind: result.kind
    };
    store.updatedAt = recordedAt;

    return store;
  });

  return Boolean(updated);
}

async function reconcileRatingHistory(): Promise<number> {
  const rooms = await listStoredRooms();
  let applied = 0;

  for (const room of rooms) {
    const hostColor = getRoomHostColor(room);
    const guestColor = getRoomGuestColor(room);

    if (room.status !== "finished" || !room.result || !room.guest || !hostColor || !guestColor) {
      continue;
    }

    const recorded = await recordRoomResult(room);
    if (recorded) {
      applied += 1;
    }
  }

  return applied;
}

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A match id comes from the browser: a UUID, or up to 64 letters, digits, "-" and "_". */
export function isValidMatchId(value: string): boolean {
  return MATCH_ID_PATTERN.test(value);
}

/** Counts a game against the bot once per match id. Returns true if it was counted now, false if it was already counted. */
export async function recordBotMatchResult(
  profile: { telegramId: number },
  outcome: "win" | "loss" | "draw",
  matchId: string
): Promise<boolean> {
  if (!isValidMatchId(matchId)) {
    throw new Error("Match ID is invalid.");
  }

  const recordedAt = new Date().toISOString();
  const key = `bot:${profile.telegramId}:${matchId}`;

  const updated = await updateStatsStore((store) => {
    if (store.appliedRooms[key]) {
      return null;
    }

    if (outcome === "draw") {
      touchUser(store.users, profile.telegramId, { draws: 1, gamesPlayed: 1 }, recordedAt);
    } else if (outcome === "win") {
      touchUser(store.users, profile.telegramId, { wins: 1, gamesPlayed: 1 }, recordedAt);
    } else {
      touchUser(store.users, profile.telegramId, { losses: 1, gamesPlayed: 1 }, recordedAt);
    }

    store.appliedRooms[key] = {
      roomId: key,
      recordedAt,
      resultKind: outcome === "loss" ? "loss" : outcome
    };
    store.updatedAt = recordedAt;

    return store;
  });

  return Boolean(updated);
}

export async function getRatingLeaderboard(): Promise<RatingLeaderboardResponse> {
  await reconcileRatingHistory();
  const [stats, profiles] = await Promise.all([readStatsStore(), listProfiles()]);
  const profileMap = new Map(profiles.map((profile) => [profile.telegramId, profile]));

  const leaderboard = Object.values(stats.users)
    .map((entry) => {
      const profile = profileMap.get(entry.telegramId);
      const nickname = profile?.nickname ?? "Игрок";

      return {
        nickname,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        gamesPlayed: entry.gamesPlayed,
        winRate: entry.gamesPlayed > 0 ? Number((entry.wins / entry.gamesPlayed).toFixed(3)) : 0,
        lastMatchAt: entry.lastMatchAt
      } satisfies RatingRow;
    })
    .sort(compareRows);

  const summary: RatingSummary = {
    recordedRooms: Object.keys(stats.appliedRooms).length,
    playersTracked: leaderboard.length,
    totalMatches: Object.keys(stats.appliedRooms).length,
    updatedAt: stats.updatedAt,
    source: "stats-json"
  };

  return { summary, leaderboard };
}
