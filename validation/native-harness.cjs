/* Manual/native validation only: isolate settings and avoid changing the user's login item. */
const { app, globalShortcut, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const profile = path.resolve(__dirname, ".native-test-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({ wasOpenedAtLogin: false });
globalShortcut.register = () => true;
globalShortcut.unregisterAll = () => {};
if (process.env.NULLPOINT_NATIVE_DIAG) {
  const log = (entry) => fs.appendFileSync(path.join(profile, "native-events.jsonl"), JSON.stringify(entry) + "\n");
  app.on("browser-window-created", (_event, win) => {
    win.webContents.on("before-input-event", (_inputEvent, input) => log({ event: "key", key: input.key, type: input.type, menu: win.isMenuBarVisible() }));
    win.on("move", () => log({ event: "move", bounds: win.getBounds() }));
  });
}
if (process.env.NULLPOINT_DRAG_TEST) {
  app.on("browser-window-created", (_event, win) => {
    win.webContents.once("did-finish-load", async () => {
      await win.webContents.executeJavaScript(`
        document.querySelector('.screen').style.animation = 'none';
        document.querySelector('.app-titlebar').style.setProperty('-webkit-app-region', 'drag');
      `);
      win.on("move", () => fs.writeFileSync(path.join(profile, "drag-result.json"), JSON.stringify(win.getBounds())));
    });
  });
}
if (process.env.NULLPOINT_SERIAL_TEST) {
  app.on("browser-window-created", (_event, win) => {
    win.webContents.once("did-finish-load", async () => {
      const wc = win.webContents;
      const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
      const results = [];
      const trigger = (ports, callback) => {
        let prevented = false;
        session.defaultSession.emit("select-serial-port", { preventDefault: () => { prevented = true; } }, ports, wc, callback);
        assert.equal(prevented, true);
      };
      try {
        await wc.executeJavaScript("window.__serialEvents = []; window.nullpoint.onSerialPorts(v => window.__serialEvents.push(v)); true");
        let chosen = null;
        trigger([{ portId: "a", displayName: "Same" }, { portId: "b", displayName: "Same" }], (id) => { chosen = id; });
        await pause();
        let events = await wc.executeJavaScript("window.__serialEvents");
        const firstId = events.at(-1).requestId;
        assert.deepEqual(events.at(-1).ports.map((p) => p.name), ["Same", "Same"]);
        ipcMain.emit("nullpoint:serial-select", { sender: {} }, firstId, "a");
        await wc.executeJavaScript(`window.nullpoint.selectSerialPort(${firstId + 1}, 'a')`);
        await pause();
        assert.equal(chosen, null, "reject wrong sender and stale request");
        session.defaultSession.emit("serial-port-removed", {}, { portId: "a" }, wc);
        session.defaultSession.emit("serial-port-added", {}, { portId: "c", displayName: "" }, wc);
        await wc.executeJavaScript(`window.nullpoint.selectSerialPort(${firstId}, 'a')`);
        await pause();
        assert.equal(chosen, null, "reject removed port");
        events = await wc.executeJavaScript("window.__serialEvents");
        assert.deepEqual(events.at(-1).ports.map((p) => [p.id, p.name]), [["b", "Same"], ["c", ""]]);
        await wc.executeJavaScript(`window.nullpoint.selectSerialPort(${firstId}, 'c')`);
        await pause();
        assert.equal(chosen, "c");
        results.push("live list, sender/request/port validation and selection");

        let cancelled = null;
        trigger([], (id) => { cancelled = id; });
        await pause();
        events = await wc.executeJavaScript("window.__serialEvents");
        const secondId = events.at(-1).requestId;
        await wc.executeJavaScript(`window.nullpoint.cancelSerialPort(${firstId})`);
        await pause();
        assert.equal(cancelled, null, "stale cancellation ignored");
        await wc.executeJavaScript(`window.nullpoint.cancelSerialPort(${secondId})`);
        await pause();
        assert.equal(cancelled, "");
        results.push("cancellation resolves exactly the active request");

        let closed = null;
        trigger([], (id) => { closed = id; });
        win.close();
        await pause();
        assert.equal(closed, "", "closing the window cancels pending selection");
        results.push("window close releases pending selection");
        fs.writeFileSync(path.join(profile, "serial-ipc-result.json"), JSON.stringify({ ok: true, results }, null, 2));
      } catch (error) {
        fs.writeFileSync(path.join(profile, "serial-ipc-result.json"), JSON.stringify({ ok: false, error: String(error.stack || error) }, null, 2));
      } finally { app.quit(); }
    });
  });
}
require("../apps/desktop/dist-electron/main.js");
