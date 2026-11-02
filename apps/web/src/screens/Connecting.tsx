import { tr } from "../i18n.js";
import { TitleBar } from "./TitleBar.js";

export function Connecting({ onCancel, onSettingsClick, selection, onSelect }: {
  onCancel: () => void;
  onSettingsClick: () => void;
  selection: { requestId: number; ports: Array<{ id: string; name: string }> } | null;
  onSelect: (requestId: number, id: string) => void;
}) {
  return <div className="screen app-shell">
    <TitleBar onSettingsClick={onSettingsClick} />
    <main className="status-content">
      {selection ? <section className="status-panel" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <h1 id="picker-title">{tr("Choose a device")}</h1>
        <p>{tr("Select a device reported by your system.")}</p>
        <div className="device-list">
          {selection.ports.length === 0 && <p role="status">{tr("No devices available yet.")}</p>}
          {selection.ports.map((port, index) => <button key={port.id}
            onClick={() => onSelect(selection.requestId, port.id)}>
            <span>{port.name.trim() || tr("Unknown device")}</span><span aria-hidden="true">{index + 1}</span>
          </button>)}
        </div>
        <button className="secondary-button" onClick={onCancel}>{tr("Cancel")}</button>
      </section> : <section className="status-panel" role="status">
        <div className="connection-spinner" aria-hidden="true" />
        <h1>{tr("Connecting…")}</h1>
        <p>{tr("Opening the control channel (RFCOMM) and reading device state.")}</p>
        <button className="secondary-button" onClick={onCancel}>{tr("Cancel")}</button>
      </section>}
    </main>
  </div>;
}
