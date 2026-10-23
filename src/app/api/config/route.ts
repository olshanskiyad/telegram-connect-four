import { NextResponse } from "next/server";

import { getBotUsername, getWsPublicUrl, isGuestModeEnabled } from "@/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public settings the browser needs. Read from the environment on every request, so no rebuild is needed. */
export async function GET() {
  return NextResponse.json(
    {
      guestMode: isGuestModeEnabled(),
      botUsername: getBotUsername(),
      wsUrl: getWsPublicUrl()
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
