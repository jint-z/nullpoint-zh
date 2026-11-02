import { tr } from "../i18n.js";
import { TitleBar } from "./TitleBar.js";

export function UnsupportedBrowser({ onSettingsClick }: { onSettingsClick: () => void }) {
  return <div className="screen app-shell">
    <TitleBar onSettingsClick={onSettingsClick} />
    <main className="status-content"><section className="status-panel">
      <h1>{tr("This browser can't talk to Bluetooth Classic devices")}</h1>
      <p>{tr("The web version needs the Web Serial API, available in Chrome, Edge, Opera and Arc on desktop. Safari and Firefox don't implement it.")}</p>
      <p>{tr("Or use the Nullpoint desktop app for Windows / macOS instead.")}</p>
    </section></main>
  </div>;
}
