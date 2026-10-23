import { NextRequest, NextResponse } from "next/server";

import { authenticateRoomRequest, roomErrorResponse } from "../_shared";
import {
  getRoom,
  heartbeatRoomView,
  joinRoom,
  makeMove,
  reconnectRoom,
  restartRoom,
  roomToView,
  updateRoomColor
} from "@/server/rooms/service";
import { findStoredRoom } from "@/server/rooms/store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type RoomActionBody = {
  initData?: string;
  action?: "join" | "reconnect" | "color" | "move" | "restart";
  color?: "red" | "green" | "random";
  column?: number;
};

/**
 * Reads the room. A signed-in viewer sends the credential in the x-init-data header
 * (not in the URL, so it stays out of access logs) and also marks themselves as present.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { roomId } = await context.params;
    const credential = request.headers.get("x-init-data")?.trim() ?? "";
    const storedRoom = await findStoredRoom(roomId);

    if (!storedRoom) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (!credential) {
      return NextResponse.json({ room: await getRoom(roomId) });
    }

    const profile = await authenticateRoomRequest(credential);
    const room = (await heartbeatRoomView(roomId, profile)) ?? roomToView(storedRoom, profile.telegramId);

    return NextResponse.json({ room });
  } catch (error) {
    return roomErrorResponse(error, "Room lookup failed.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as RoomActionBody;
    const profile = await authenticateRoomRequest(body.initData);

    if (body.action === "join") {
      const room = await joinRoom(roomId, profile);
      return NextResponse.json({ room });
    }

    if (body.action === "reconnect") {
      const room = await reconnectRoom(roomId, profile);
      return NextResponse.json({ room });
    }

    if (body.action === "color") {
      const color = body.color;

      if (color !== "red" && color !== "green" && color !== "random") {
        return NextResponse.json(
          { error: "Color must be red, green, or random." },
          { status: 400 }
        );
      }

      const room = await updateRoomColor(roomId, profile, color);
      return NextResponse.json({ room });
    }

    if (body.action === "move") {
      const column = body.column;

      if (!Number.isInteger(column)) {
        return NextResponse.json(
          { error: "Column must be an integer." },
          { status: 400 }
        );
      }

      const room = await makeMove(roomId, profile, column as number);
      return NextResponse.json({ room });
    }

    if (body.action === "restart") {
      const room = await restartRoom(roomId, profile);
      return NextResponse.json({ room });
    }

    return NextResponse.json({ error: "Unsupported room action." }, { status: 400 });
  } catch (error) {
    return roomErrorResponse(error, "Room action failed.");
  }
}
