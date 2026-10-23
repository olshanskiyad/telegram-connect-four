import { NextResponse } from "next/server";

import { authenticateUser } from "@/server/profile/service";
import type { StoredProfile } from "@/server/profile/store";
import { RoomServiceError } from "@/server/rooms/service";

/** Accepts Telegram initData or a guest token (the request field is called initData for both). */
export async function authenticateRoomRequest(initData?: string): Promise<StoredProfile> {
  const value = initData?.trim() ?? "";

  if (!value) {
    throw new RoomServiceError("Authentication is required.", 400);
  }

  return authenticateUser(value);
}

export function roomErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof RoomServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status: 400 });
}
