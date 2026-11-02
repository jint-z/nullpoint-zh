import { tr } from "../i18n.js";

export function Segmented<T extends number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={tr(ariaLabel)} style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {tr(options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="mono"
            style={{
              fontWeight: 500,
              fontSize: 9.5,
              letterSpacing: "0.08em",
              padding: "6px 9px",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
              color: selected ? "var(--bg)" : "var(--fg3)",
              background: selected ? "var(--accent)" : "none",
              border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {tr(option.label)}
          </button>
        );
      }))}
    </div>
  );
}
