const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, ".native-test-profile", "appdata-probe.json"), JSON.stringify({ appData: app.getPath("appData"), expected: process.env.APPDATA }));
app.quit();
