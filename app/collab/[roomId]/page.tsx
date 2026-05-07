import { CollaborationRoomApp } from "@/components/collaboration-room-app";

export default async function CollaborationRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return <CollaborationRoomApp roomId={roomId} />;
}
