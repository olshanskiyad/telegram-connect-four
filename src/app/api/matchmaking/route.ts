import { NextRequest, NextResponse } from "next/server";

import { authenticateRoomRequest } from "../rooms/_shared";
import {
  MatchmakingServiceError,
  cancelMatchmakingQueue,
  getMatchmakingStatus,
  joinMatchmakingQueue
} from "@/server/matchmaking/service";

export const runtime = "nodejs";

type MatchmakingBody = {
  action?: "join" | "status" | "cancel";
  initData?: string;
};

function matchmakingErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof MatchmakingServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MatchmakingBody;
    const profile = await authenticateRoomRequest(body.initData);
    const action = body.action ?? "status";

    if (action === "join") {
      const queue = await joinMatchmakingQueue(profile);
      return NextResponse.json({ matchmaking: queue, queue });
    }

    if (action === "cancel") {
      const queue = await cancelMatchmakingQueue(profile);
      return NextResponse.json({ matchmaking: queue, queue });
    }

    const queue = await getMatchmakingStatus(profile);
    return NextResponse.json({ matchmaking: queue, queue });
  } catch (error) {
    return matchmakingErrorResponse(error, "Matchmaking request failed.");
  }
}
