import { NextRequest, NextResponse } from "next/server";

import { authenticateTelegramUser } from "@/server/profile/service";

export const runtime = "nodejs";

type TelegramAuthBody = {
  initData?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TelegramAuthBody;
    const initData = body.initData?.trim() ?? "";

    if (!initData) {
      return NextResponse.json(
        { error: "Telegram initData is required." },
        { status: 400 }
      );
    }

    const profile = await authenticateTelegramUser(initData);

    return NextResponse.json({
      profile,
      authType: "telegram"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
