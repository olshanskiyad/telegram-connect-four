import { NextResponse } from 'next/server';

import { getRatingLeaderboard } from '@/server/stats/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    const rating = await getRatingLeaderboard();
    return NextResponse.json(rating, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rating lookup failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
