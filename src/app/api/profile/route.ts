import { NextRequest, NextResponse } from "next/server";

import { changeNickname } from "@/server/profile/service";

export const runtime = "nodejs";

type ProfileBody = {
  initData?: string;
  nickname?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ProfileBody;
    const initData = body.initData?.trim() ?? "";
    const nickname = body.nickname?.trim() ?? "";

    if (!initData) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 400 }
      );
    }

    if (!nickname) {
      return NextResponse.json({ error: "Nickname is required." }, { status: 400 });
    }

    const profile = await changeNickname(initData, nickname);

    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
