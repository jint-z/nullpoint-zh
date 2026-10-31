const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configureWindowsProfile, WINDOWS_APP_ID, WINDOWS_LOGIN_ITEM_NAME } = require("../apps/desktop/dist-electron/profile.js");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nullpoint-zh-profile-test-"));
try {
  const calls = [];
  const app = {
    getPath(name) {
      assert.equal(name, "appData");
      return temporaryRoot;
    },
    setPath(name, value) {
      assert.ok(fs.statSync(value).isDirectory(), "profile must exist before setPath");
      calls.push([name, value]);
    },
    setAppUserModelId(value) {
      calls.push(["appId", value]);
    },
  };

  configureWindowsProfile(app);
  const profile = path.join(temporaryRoot, "Nullpoint-zh");
  assert.deepEqual(calls, [
    ["userData", profile],
    ["sessionData", profile],
    ["appId", WINDOWS_APP_ID],
  ]);
  assert.equal(WINDOWS_LOGIN_ITEM_NAME, "Nullpoint-zh");
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ language: "en" }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")).language, "en");
  console.log("PASS: installed profile is created and writable independently of the executable directory");
} finally {
  const prefix = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(temporaryRoot).startsWith(prefix)) throw new Error("Refusing to remove an unexpected path");
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
