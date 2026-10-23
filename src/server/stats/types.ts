export type StoredUserStats = {
  telegramId: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  lastMatchAt: string | null;
  updatedAt: string;
};

export type StoredAppliedRoom = {
  roomId: string;
  recordedAt: string;
  resultKind: 'win' | 'draw' | 'loss';
};

export type StatsStore = {
  updatedAt: string;
  users: Record<string, StoredUserStats>;
  appliedRooms: Record<string, StoredAppliedRoom>;
};

/** One line of the public leaderboard. The player's Telegram id is not included. */
export type RatingRow = {
  nickname: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winRate: number;
  lastMatchAt: string | null;
};

export type RatingSummary = {
  recordedRooms: number;
  playersTracked: number;
  totalMatches: number;
  updatedAt: string;
  source: 'stats-json';
};

export type RatingLeaderboardResponse = {
  summary: RatingSummary;
  leaderboard: RatingRow[];
};
