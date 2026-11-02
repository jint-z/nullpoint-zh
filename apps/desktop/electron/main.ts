import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, nativeTheme, net, protocol, session } from "electron";
import path from "node:path";
import { configureWindowsProfile } from "./profile.js";
import translations from "./translations.json";
const words: Record<string, string> = translations;
function menuText(english: string): string { return readSettings().language === "en" ? english : (words[english] ?? english); }
import { pathToFileURL } from "node:url";
import {
  applyLoginItemSetting,
  readSettings,
  writeSettings,
  type DesktopSettings,
} from "./settings.js";

// PLAN.md §5.4 — Electron's renderer is Chromium, so the same navigator.serial code the web
// app uses works here unmodified. The desktop-specific wiring is: grant the "serial" permission,
// auto-answer the port picker, and run as a tray app that can start hidden at login.

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;
// An installed Windows app may live in a read-only directory. Configure its isolated,
// per-user profile before Electron creates a session or obtains its single-instance lock.
if (app.isPackaged && process.platform === "win32") {
  configureWindowsProfile(app);
} else if (app.isPackaged) {
  app.setPath("userData", path.join(path.dirname(process.execPath), "nullpoint-data"));
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Distinguishes "user closed the window" (hide to tray) from "app is really quitting". */
let isQuitting = false;

/**
 * The packaged renderer is served over a custom app:// scheme rather than file://, for two
 * reasons: Vite emits absolute asset paths (/assets/…) which file:// would resolve against the
 * filesystem root, and navigator.serial requires a secure context. Registering the scheme as
 * `secure` + `standard` gives us both.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function rendererDir(): string {
  // extraResources in electron-builder.yml copies apps/web/dist -> resources/renderer
  return path.join(process.resourcesPath, "renderer");
}

function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    // SPA fallback: anything without a file extension is a client-side route.
    if (rel === "/" || !path.extname(rel)) rel = "/index.html";

    const target = path.join(rendererDir(), rel);
    // Never serve outside the renderer directory, even if the URL contains traversal segments.
    if (!target.startsWith(rendererDir())) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

let serialRequestId = 0;
let serialSelection: { id: number; owner: Electron.WebContents; ports: Map<string, Electron.SerialPort>; callback: (portId: string) => void } | null = null;

function publishSerialPorts(): void {
  const current = serialSelection;
  if (!current || current.owner.isDestroyed()) return;
  current.owner.send("nullpoint:serial-ports", {
    requestId: current.id,
    ports: [...current.ports.values()].map((port) => ({ id: port.portId, name: port.displayName || "" })),
  });
}

function finishSerialSelection(portId = ""): void {
  const current = serialSelection;
  if (!current) return;
  serialSelection = null;
  current.callback(portId);
}

function applyTitleBarTheme(): void {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
  const theme = readSettings().theme;
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  mainWindow.setTitleBarOverlay({ color: dark ? "#252729" : "#eceeec", symbolColor: dark ? "#f4f5f6" : "#202326", height: 48 });
}

/** True when this launch came from the OS login item (or the user passed --hidden). */
function shouldStartHidden(): boolean {
  if (process.argv.includes("--hidden")) return true;
  // macOS reports this directly rather than through argv.
  return app.getLoginItemSettings().wasOpenedAtLogin === true;
}

function createWindow(show: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 560,
    title: "Nullpoint",
    show,
    ...(process.platform === "win32" ? {
      titleBarStyle: "hidden" as const,
      titleBarOverlay: { color: "#252729", symbolColor: "#f4f5f6", height: 48 },
      autoHideMenuBar: true,
    } : {}),
    // Avoid a white flash before the dark UI paints.
    backgroundColor: "#0b0c0e",
    // Windows/Linux read the window icon from here; macOS uses the bundle icon.
    icon: assetPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  // The Windows overlay hides the menu bar. An unmodified Alt opens the original native menu
  // below the title bar; shortcuts such as Alt+F4 continue through to the operating system.
  if (process.platform === "win32") {
    let altAlone = false;
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (input.key === "Alt") altAlone = true;
        else if (altAlone) altAlone = false;
      } else if (input.type === "keyUp" && input.key === "Alt") {
        if (altAlone) {
          event.preventDefault();
          Menu.getApplicationMenu()?.popup({ window: win, x: 0, y: 48 });
        }
        altAlone = false;
      }
    });
  }

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadURL("app://local/");
  }

  win.on("close", (event) => {
    if (serialSelection?.owner === win.webContents) finishSerialSelection();
    // Keep running in the tray unless the user actually chose Quit.
    if (!isQuitting && readSettings().closeToTray) {
      event.preventDefault();
      win.hide();
      syncMacDockVisibility();
    }
  });

  win.on("show", syncMacDockVisibility);
  win.on("hide", syncMacDockVisibility);

  win.on("closed", () => {
    mainWindow = null;
    syncMacDockVisibility();
  });

  return win;
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(true);
    applyTitleBarTheme();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function assetPath(name: string): string {
  // assets/ sits next to dist-electron/ both in the repo and inside the packaged asar.
  return path.join(__dirname, "..", "assets", name);
}

/**
 * macOS treats a menu-bar-only app as one with no Dock presence. Hiding the Dock icon while
 * no window is open is what makes Nullpoint feel native there; it comes back when a window does.
 */
function syncMacDockVisibility(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const anyVisible = BrowserWindow.getAllWindows().some((w) => w.isVisible());
  if (anyVisible) void app.dock.show();
  else app.dock.hide();
}

function buildTray(): void {
  const icon = nativeImage.createFromPath(assetPath("tray.png"));
  // On macOS a template image adapts automatically to light/dark menu bars.
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Nullpoint");
  refreshTrayMenu();
  // Windows/Linux: a plain click should open the app; macOS shows the menu instead.
  tray.on("click", () => {
    if (process.platform === "darwin") return;
    showWindow();
  });
}

/**
 * What the renderer last told us about the headphones, so the tray can show and change the
 * noise mode without opening a window. The main process has no Bluetooth connection of its
 * own — this is a mirror, and every action is sent back to the renderer to perform.
 */
let trayState: { model: string | null; battery: number | null; mode: string | null } = {
  model: null,
  battery: null,
  mode: null,
};

function sendHotkey(action: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("nullpoint:hotkey", action);
  }
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const settings = readSettings();
  const connected = trayState.model !== null;
  const status = connected
    ? `${trayState.model}${trayState.battery !== null ? `  ${trayState.battery}%` : ""}`
    : menuText("No headphones connected");
  tray.setToolTip(connected ? `Nullpoint — ${status}` : "Nullpoint");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: "separator" },
      // Radio items rather than buttons: the tray should show which mode is active, not just
      // offer three ways to change it.
      {
        label: menuText("Noise Cancelling"),
        type: "radio",
        enabled: connected,
        checked: trayState.mode === "anc",
        click: () => sendHotkey("anc"),
      },
      {
        label: menuText("Ambient Sound"),
        type: "radio",
        enabled: connected,
        checked: trayState.mode === "ambient",
        click: () => sendHotkey("ambient"),
      },
      {
        label: menuText("Off"),
        type: "radio",
        enabled: connected,
        checked: trayState.mode === "off",
        click: () => sendHotkey("off"),
      },
      { type: "separator" },
      { label: menuText("Open Nullpoint"), click: () => showWindow() },
      { type: "separator" },
      {
        label: menuText("Global shortcuts"),
        type: "checkbox",
        checked: settings.hotkeys,
        click: (item) => {
          writeSettings({ hotkeys: item.checked });
          broadcastSettings();
        },
      },
      {
        label: menuText("Launch at login"),
        type: "checkbox",
        checked: settings.launchAtLogin,
        click: (item) => {
          writeSettings({ launchAtLogin: item.checked });
          applyLoginItemSetting(item.checked);
          broadcastSettings();
        },
      },
      { type: "separator" },
      {
        label: menuText("Quit Nullpoint"),
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

/**
 * Noise-mode shortcuts that work from any application — the whole point of a desktop client,
 * and the thing people were writing separate utilities to get.
 *
 * The main process owns the keys but not the headphones: only the renderer holds the Bluetooth
 * connection, so a press is forwarded to it. That works even with the window hidden in the
 * tray, because hiding keeps the renderer alive.
 */
const HOTKEYS: Array<{ accelerator: string; action: string }> = [
  { accelerator: "CommandOrControl+Alt+N", action: "cycle" },
  { accelerator: "CommandOrControl+Alt+1", action: "anc" },
  { accelerator: "CommandOrControl+Alt+2", action: "ambient" },
  { accelerator: "CommandOrControl+Alt+3", action: "off" },
];

function applyHotkeys(): void {
  globalShortcut.unregisterAll();
  if (!readSettings().hotkeys) return;
  for (const { accelerator, action } of HOTKEYS) {
    // Registration fails when another app already owns the combination. That is not an error
    // worth interrupting anyone over, but it should not be silent either.
    const ok = globalShortcut.register(accelerator, () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("nullpoint:hotkey", action);
      }
    });
    if (!ok) console.warn(`[nullpoint] another application already owns ${accelerator}`);
  }
}

function refreshApplicationMenu(): void {
  const item = (role: Electron.MenuItemConstructorOptions["role"], _cn: string, en: string): Electron.MenuItemConstructorOptions => ({ role, label: menuText(en) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: menuText("File"), submenu: [item("close", "关闭窗口", "Close")] },
    { label: menuText("Edit"), submenu: [item("undo", "撤销", "Undo"), item("redo", "重做", "Redo"), {type:"separator"}, item("cut", "剪切", "Cut"), item("copy", "复制", "Copy"), item("paste", "粘贴", "Paste"), item("selectAll", "全选", "Select All")] },
    { label: menuText("View"), submenu: [item("reload", "重新加载", "Reload"), item("forceReload", "强制重新加载", "Force Reload"), item("toggleDevTools", "开发者工具", "Toggle Developer Tools"), {type:"separator"}, item("resetZoom", "实际大小", "Actual Size"), item("zoomIn", "放大", "Zoom In"), item("zoomOut", "缩小", "Zoom Out"), {type:"separator"}, item("togglefullscreen", "切换全屏", "Toggle Full Screen")] },
    { label: menuText("Window"), submenu: [item("minimize", "最小化", "Minimize"), item("close", "关闭窗口", "Close")] },
  ]));
}

function broadcastSettings(): void {
  refreshTrayMenu();
  refreshApplicationMenu();
  applyHotkeys();
  const settings = readSettings();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("nullpoint:settings-changed", settings);
  }
}

// A tray app must be single-instance: a second launch should surface the running window
// rather than adding a second tray icon.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    if (!isDev) registerAppProtocol();

    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "serial");

    // Without this, a port chosen below is still refused when the renderer tries to open it.
    session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === "serial");

    session.defaultSession.on("select-serial-port", (event, portList, webContents, callback) => {
      event.preventDefault();
      if (webContents !== mainWindow?.webContents) { callback(""); return; }
      finishSerialSelection();
      serialSelection = { id: ++serialRequestId, owner: webContents, ports: new Map(portList.map((p) => [p.portId, p])), callback };
      publishSerialPorts();
    });
    session.defaultSession.on("serial-port-added", (_event, port, webContents) => {
      if (serialSelection?.owner !== webContents) return;
      serialSelection.ports.set(port.portId, port);
      publishSerialPorts();
    });
    session.defaultSession.on("serial-port-removed", (_event, port, webContents) => {
      if (serialSelection?.owner !== webContents) return;
      serialSelection.ports.delete(port.portId);
      publishSerialPorts();
    });
    ipcMain.on("nullpoint:serial-select", (event, requestId: unknown, portId: unknown) => {
      const current = serialSelection;
      if (!current || current.owner !== event.sender || current.id !== requestId || typeof portId !== "string" || !current.ports.has(portId)) return;
      finishSerialSelection(portId);
    });
    ipcMain.on("nullpoint:serial-cancel", (event, requestId: unknown) => {
      const current = serialSelection;
      if (current && current.owner === event.sender && (requestId === current.id || requestId === null)) finishSerialSelection();
    });

    // Keep the OS login item in sync with the stored setting, in case it was changed elsewhere.
    const settings = readSettings();
    applyLoginItemSetting(settings.launchAtLogin);

    // The renderer mirrors its connection state here so the tray can reflect it.
    ipcMain.on("nullpoint:device-state", (_event, next: typeof trayState) => {
      trayState = next;
      refreshTrayMenu();
    });
    ipcMain.handle("nullpoint:get-settings", () => readSettings());
    ipcMain.handle("nullpoint:set-settings", (_event, patch: Partial<DesktopSettings>) => {
      const next = writeSettings(patch);
      if (patch.launchAtLogin !== undefined) applyLoginItemSetting(patch.launchAtLogin);
      refreshTrayMenu();
      refreshApplicationMenu();
      applyTitleBarTheme();
      return next;
    });

    buildTray();
    refreshApplicationMenu();
    applyHotkeys();

    const startHidden = shouldStartHidden() || settings.startMinimized;
    mainWindow = createWindow(!startHidden);
    applyTitleBarTheme();
    nativeTheme.on("updated", applyTitleBarTheme);
    syncMacDockVisibility();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(true);
      else showWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  finishSerialSelection();
});

// Deliberately no "window-all-closed" quit: Nullpoint keeps running in the tray so it can
// reconnect to the headphones. Quitting happens through the tray menu.
