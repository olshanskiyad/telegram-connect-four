import { NextRequest, NextResponse } from "next/server";

import { authenticateUser } from "@/server/profile/service";
import { countRecentlySeenProfiles } from "@/server/profile/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PresenceBody = {
  initData?: string;
};

export async function GET() {
  const onlinePlayers = await countRecentlySeenProfiles();
  return NextResponse.json({ onlinePlayers });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PresenceBody;
    const initData = body.initData?.trim() ?? "";

    if (!initData) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 400 });
    }

    await authenticateUser(initData);
    const onlinePlayers = await countRecentlySeenProfiles();

    return NextResponse.json({ onlinePlayers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Presence heartbeat failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
