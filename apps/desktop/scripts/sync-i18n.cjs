const fs = require("node:fs");
const path = require("node:path");
fs.copyFileSync(path.resolve(__dirname, "../../web/src/translations.json"), path.resolve(__dirname, "../electron/translations.json"));
