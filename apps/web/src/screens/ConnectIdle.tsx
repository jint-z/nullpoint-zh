import { tr } from "../i18n.js";
import { TitleBar } from "./TitleBar.js";

export function ConnectIdle({ onConnect, onSettingsClick, preparing }: {
  onConnect: () => void;
  onSettingsClick: () => void;
  preparing: boolean;
}) {
  return <div className="screen app-shell">
    <TitleBar onSettingsClick={onSettingsClick} />
    <main className="idle-content">
      <button className="primary-button connect-button" disabled={preparing} onClick={onConnect}>
        {tr(preparing ? "Preparing…" : "Connect headphones")}
      </button>
    </main>
  </div>;
}
