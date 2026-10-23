import { NextRequest, NextResponse } from "next/server";

import { authenticateUser } from "@/server/profile/service";
import { isValidMatchId, recordBotMatchResult } from "@/server/stats/service";

export const runtime = "nodejs";

type BotStatsBody = {
  initData?: string;
  matchId?: string;
  outcome?: "win" | "loss" | "draw";
};

/** Records the result of a game against the bot. The bot runs in the browser, so the result is reported by the client and is not verified. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BotStatsBody;
    const initData = body.initData?.trim() ?? "";
    const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
    const outcome = body.outcome;

    if (!initData) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 400 });
    }

    if (!matchId) {
      return NextResponse.json({ error: "Match ID is required." }, { status: 400 });
    }

    if (!isValidMatchId(matchId)) {
      return NextResponse.json({ error: "Match ID is invalid." }, { status: 400 });
    }

    if (outcome !== "win" && outcome !== "loss" && outcome !== "draw") {
      return NextResponse.json({ error: "Outcome is required." }, { status: 400 });
    }

    const profile = await authenticateUser(initData);
    await recordBotMatchResult(profile, outcome, matchId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bot stats update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
