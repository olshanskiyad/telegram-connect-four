type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      initDataUnsafe?: {
        start_param?: string;
        user?: { id?: number };
      };
      ready?: () => void;
      expand?: () => void;
    };
  };
};

export function getTelegramWebApp() {
  if (typeof window === "undefined") return undefined;
  return (window as TelegramWindow).Telegram?.WebApp;
}

function readTelegramLaunchParam(name: string): string {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  return params.get(name) ?? "";
}

export function getTelegramInitData(): string {
  const webApp = getTelegramWebApp();
  if (webApp?.initData) return webApp.initData;
  return readTelegramLaunchParam("tgWebAppData") ?? "";
}

export function getTelegramStartParam(): string {
  const webApp = getTelegramWebApp();

  if (webApp?.initDataUnsafe?.start_param) {
    return webApp.initDataUnsafe.start_param.trim();
  }

  const fromQuery =
    readTelegramLaunchParam("tgWebAppStartParam") ||
    readTelegramLaunchParam("startapp") ||
    readTelegramLaunchParam("start_param");

  return fromQuery.trim();
}

export function bootstrapTelegramWebApp(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;
  webApp.ready?.();
  webApp.expand?.();
}
