import { NextRequest, NextResponse } from "next/server";

import { authenticateRoomRequest, roomErrorResponse } from "./_shared";
import { createRoom } from "@/server/rooms/service";

export const runtime = "nodejs";

type CreateRoomBody = {
  initData?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateRoomBody;
    const profile = await authenticateRoomRequest(body.initData);
    const room = await createRoom(profile);

    return NextResponse.json({ room });
  } catch (error) {
    return roomErrorResponse(error, "Room creation failed.");
  }
}
