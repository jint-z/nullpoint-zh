import type { App } from "electron";
import fs from "node:fs";
import path from "node:path";

export const WINDOWS_APP_ID = "io.github.jint-z.nullpoint-zh";
export const WINDOWS_LOGIN_ITEM_NAME = "Nullpoint-zh";
export const WINDOWS_PROFILE_DIRECTORY = "Nullpoint-zh";

/** Configure the installed Windows edition before Electron's ready event. */
export function configureWindowsProfile(app: Pick<App, "getPath" | "setPath" | "setAppUserModelId">): void {
  const directory = path.join(app.getPath("appData"), WINDOWS_PROFILE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  app.setAppUserModelId(WINDOWS_APP_ID);
}
