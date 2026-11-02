import { tr } from "../i18n.js";
import { describeConnectError } from "../state/useHeadphones.js";
import { TitleBar } from "./TitleBar.js";

export function ConnectFailed({ message, onRetry, onChooseAnother, onSettingsClick }: {
  message: string; onRetry: () => void; onChooseAnother: () => void; onSettingsClick: () => void;
}) {
  const { headline, hint, steps, detail } = describeConnectError(new Error(message));
  return <div className="screen app-shell">
    <TitleBar onSettingsClick={onSettingsClick} />
    <main className="status-content">
      <section className="status-panel error-panel" role="alert">
        <h1>{tr(headline)}</h1><p>{tr(hint)}</p>
        {steps && <ol>{steps.map((step) => <li key={step}>{tr(step)}</li>)}</ol>}
        <p className="error-detail">{detail}</p>
        <div className="status-actions">
          <button className="primary-button" onClick={onRetry}>{tr("Try again")}</button>
          <button className="secondary-button" onClick={onChooseAnother}>{tr("Choose another device")}</button>
        </div>
      </section>
    </main>
  </div>;
}
