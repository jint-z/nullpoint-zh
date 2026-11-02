import type { NoiseMode } from "@ssc/core";
import { tr } from "../i18n.js";

const MODES: Array<{ id: NoiseMode; label: string; symbol: string }> = [
  { id: "anc", label: "Noise Canceling", symbol: "≋" },
  { id: "ambient", label: "Ambient Sound", symbol: "☼" },
  { id: "off", label: "Off", symbol: "⊘" },
];

export function NoiseModeSegmented({ value, onChange }: { value: NoiseMode; onChange: (mode: NoiseMode) => void }) {
  return <div className="noise-modes" role="group" aria-label={tr("Noise control mode")}>
    {MODES.map((mode) => <button key={mode.id} type="button" className="noise-mode"
      aria-pressed={value === mode.id} onClick={() => onChange(mode.id)}>
      <span className="noise-mode-circle" aria-hidden="true">{mode.symbol}</span>
      <span>{tr(mode.label)}</span>
    </button>)}
  </div>;
}
