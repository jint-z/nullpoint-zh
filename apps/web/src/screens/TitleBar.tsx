import { tr } from "../i18n.js";

/** The native Windows caption buttons occupy the overlay's safe area. */
export function TitleBar({ onSettingsClick, onDone }: {
  onSettingsClick?: () => void;
  onDone?: () => void;
  statusColor?: string;
}) {
  return (
    <header className={typeof window !== "undefined" && window.nullpoint ? "app-titlebar desktop-titlebar" : "app-titlebar"}>
      <div className="titlebar-content">
        <div className="titlebar-brand"><span>NULLPOINT</span></div>
        <button className="titlebar-action" onClick={onDone ?? onSettingsClick}>
          {onDone ? <span aria-hidden="true">←</span> : <span aria-hidden="true">⚙</span>}
          {tr(onDone ? "Done" : "Settings")}
        </button>
      </div>
    </header>
  );
}
