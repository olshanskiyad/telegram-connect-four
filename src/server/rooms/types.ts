import type {
  Board,
  PlayerColor,
  WinnerLineCell
} from "@/lib/connect-four";

export type RoomStatus = "lobby" | "active" | "finished";

export type RoomRole = "host" | "guest" | "spectator";

/** Copy of the player's profile stored in a room. Contains personal data, stays on the server. */
export type RoomContactSnapshot = {
  telegramId: number;
  telegramName: string;
  telegramUsername: string | null;
  telegramPhotoUrl: string | null;
  nickname: string;
};

export type RoomParticipant = RoomContactSnapshot & {
  joinedAt: string;
  lastSeenAt: string;
};

/** What other players and spectators get to see: the nickname only. */
export type PublicParticipant = Pick<RoomParticipant, "nickname" | "joinedAt" | "lastSeenAt">;

export type RoomMove = {
  index: number;
  telegramId: number;
  color: PlayerColor;
  column: number;
  row: number;
  createdAt: string;
};

export type RoomColorAssignments = Record<string, PlayerColor>;

export type RoomStoredResult =
  | {
      kind: "win";
      winner: PlayerColor;
      line: WinnerLineCell[];
    }
  | {
      kind: "draw";
    }
  | null;

export type RoomSessionScore = {
  host: number;
  guest: number;
};

export type StoredRoom = {
  id: string;
  inviteCode: string;
  currentMatchId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RoomStatus;
  host: RoomParticipant;
  guest: RoomParticipant | null;
  spectators: RoomParticipant[];
  hostColor: PlayerColor | null;
  turnColor: PlayerColor | null;
  colorAssignments: RoomColorAssignments;
  score: RoomSessionScore;
  board: Board;
  result: RoomStoredResult;
  moves: RoomMove[];
};

export type RoomViewer = {
  telegramId: number;
  role: RoomRole;
  color: PlayerColor | null;
};

/** The room as the browser receives it (HTTP and WebSocket). No Telegram ids, names, usernames or photos. */
export type RoomView = {
  id: string;
  inviteCode: string;
  currentMatchId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RoomStatus;
  host: PublicParticipant;
  guest: PublicParticipant | null;
  hostColor: PlayerColor | null;
  guestColor: PlayerColor | null;
  turnColor: PlayerColor | null;
  score: RoomSessionScore;
  board: Board;
  result: RoomStoredResult;
  spectatorCount: number;
  playerCount: number;
  readyToStart: boolean;
  viewer: RoomViewer | null;
};

export type RoomProfileInput = RoomContactSnapshot;
