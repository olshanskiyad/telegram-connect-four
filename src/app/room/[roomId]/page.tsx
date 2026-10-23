import { RoomClient } from "@/components/room-client";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
  searchParams?: Promise<{
    source?: string;
  }>;
};

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const { roomId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const source = resolvedSearchParams?.source === "random" ? "random" : "invite";

  return <RoomClient roomId={roomId} source={source} />;
}
