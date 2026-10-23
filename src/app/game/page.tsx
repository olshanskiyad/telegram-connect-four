import { Suspense } from "react";

import BotGame from "@/components/bot-game";

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <BotGame />
    </Suspense>
  );
}

