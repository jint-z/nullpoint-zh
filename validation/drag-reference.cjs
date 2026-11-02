const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const profile = path.join(__dirname, ".native-test-profile");
app.setPath("userData", path.join(profile, "drag-reference"));
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 600, height: 400, title: "Nullpoint drag reference" });
  const record = () => fs.writeFileSync(path.join(profile, "drag-reference.json"), JSON.stringify(win.getBounds()));
  win.on("move", record);
  record();
  win.loadURL("data:text/html,<title>Nullpoint drag reference</title><p>Native Windows title bar</p>");
});
app.on("window-all-closed", () => app.quit());
