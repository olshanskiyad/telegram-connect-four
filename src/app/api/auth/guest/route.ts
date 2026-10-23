import { NextRequest, NextResponse } from "next/server";

import { isGuestModeEnabled } from "@/server/config";
import { openGuestSession } from "@/server/profile/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuestAuthBody = {
  token?: string;
};

/**
 * Starts a guest session. Send the token saved by the browser to get the same guest back;
 * without a valid token a new guest is created. Works only when guest mode is on.
 */
export async function POST(request: NextRequest) {
  if (!isGuestModeEnabled()) {
    return NextResponse.json({ error: "Guest mode is disabled." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as GuestAuthBody;
    const savedToken = typeof body.token === "string" ? body.token.trim() : "";
    const { profile, token } = await openGuestSession(savedToken);

    return NextResponse.json({
      profile,
      token,
      authType: "guest"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guest sign-in failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
