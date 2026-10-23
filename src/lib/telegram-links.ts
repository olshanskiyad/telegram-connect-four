/** Link that opens the Mini App of the bot on a given room (the bot's Main Mini App must be set up in @BotFather). */
export function buildTelegramRoomLink(botUsername: string, roomCode: string): string {
  const bot = botUsername.trim().replace(/^@/, "");

  if (!bot) {
    return "";
  }

  return `https://t.me/${bot}?startapp=${encodeURIComponent(`room-${roomCode.trim()}`)}`;
}
