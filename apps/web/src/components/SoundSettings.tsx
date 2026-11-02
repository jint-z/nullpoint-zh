import { tr } from "../i18n.js";
import type { ReactNode } from "react";
import {
  AutoPowerOff,
  DetectSensitivity,
  ModeOutTime,
  PriorMode,
  UpscalingTypeAutoOff,
  type SpeakToChatState,
} from "@ssc/core";
import { Switch } from "./Switch.js";
import { Collapse } from "./Collapse.js";
import { Segmented } from "./Segmented.js";

/**
 * The capability-gated extras: connection quality, DSEE upscaling and Speak-to-Chat.
 *
 * Every row is driven by whether the headphones reported the matching capability, never by the
 * model name. A setting this hardware doesn't have is omitted, and if none of them apply the
 * whole panel disappears — see PLAN.md standing rule 4.
 */

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 150, flex: "1 1 auto" }}>
        <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--fg2)" }}>{tr(label)}</div>
        <div className="mono" style={{ marginTop: 3, fontSize: 10, color: "var(--fg3)" }}>
          {tr(hint)}
        </div>
      </div>
      <div style={{ flex: "0 0 auto" }}>{tr(children)}</div>
    </div>
  );
}

export function SoundSettings({
  modelName,
  connectionMode,
  upscaling,
  speakToChat,
  pauseOnRemoval,
  headGesture,
  autoPowerOff,
  autoPowerOffWrite,
  onConnectionModeChange,
  onUpscalingChange,
  onSpeakToChatChange,
  speakToChatLocked,
  onLockSpeakToChange,
  onPauseOnRemovalChange,
  onHeadGestureChange,
  onAutoPowerOffChange,
}: {
  modelName: string | null;
  connectionMode: PriorMode | null;
  upscaling: UpscalingTypeAutoOff | null;
  speakToChat: SpeakToChatState | null;
  pauseOnRemoval: boolean | null;
  headGesture: boolean | null;
  autoPowerOff: AutoPowerOff | null;
  autoPowerOffWrite: "idle" | "pending" | "unconfirmed" | "rejected";
  onConnectionModeChange: (mode: PriorMode) => void;
  onUpscalingChange: (value: UpscalingTypeAutoOff) => void;
  onSpeakToChatChange: (next: SpeakToChatState) => void;
  /** True when the app is holding Speak-to-Chat at a chosen value. */
  speakToChatLocked?: boolean;
  /** Pass a value to lock it there, or undefined to stop holding it. */
  onLockSpeakToChange?: (value: boolean | undefined) => void;
  onPauseOnRemovalChange: (enabled: boolean) => void;
  onHeadGestureChange: (enabled: boolean) => void;
  onAutoPowerOffChange: (value: AutoPowerOff) => void;
}) {
  const isXm6 = modelName?.trim().toUpperCase() === "WH-1000XM6";
  const powerOptions = isXm6
    ? [
        { value: AutoPowerOff.WHEN_REMOVED, label: "AFTER REMOVAL" },
        { value: AutoPowerOff.DISABLED, label: "DO NOT TURN OFF" },
      ]
    : [
        { value: AutoPowerOff.AFTER_5_MIN, label: "5 MIN" },
        { value: AutoPowerOff.AFTER_30_MIN, label: "30 MIN" },
        { value: AutoPowerOff.AFTER_180_MIN, label: "3 HR" },
        { value: AutoPowerOff.WHEN_REMOVED, label: "WHEN OFF EARS" },
        { value: AutoPowerOff.DISABLED, label: "NEVER" },
      ];
  const anything = speakToChat !== null || pauseOnRemoval !== null || autoPowerOff !== null ||
    connectionMode !== null || upscaling !== null || headGesture !== null;
  if (!anything) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 15,
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--panel)",
      }}
    >
      <div
        className="mono"
        style={{ fontWeight: 600, fontSize: 11, letterSpacing: "0.14em", color: "var(--fg3)", height: 16 }}
      >
        {tr("MORE SOUND SETTINGS")}</div>

      {tr(connectionMode !== null && (
        <Row label="Connection quality" hint="Bitrate against link stability">
          <Segmented
            ariaLabel="Connection quality"
            value={connectionMode}
            onChange={onConnectionModeChange}
            options={[
              { value: PriorMode.SOUND_QUALITY, label: "SOUND" },
              { value: PriorMode.CONNECTION_QUALITY, label: "STABLE" },
              { value: PriorMode.LOW_LATENCY_BETA, label: "LOW LATENCY" },
            ]}
          />
        </Row>
      ))}

      {tr(upscaling !== null && (
        <Row label="DSEE Extreme" hint="Restores detail lost to compression">
          <Switch
            checked={upscaling === UpscalingTypeAutoOff.AUTO}
            onChange={(on) => onUpscalingChange(on ? UpscalingTypeAutoOff.AUTO : UpscalingTypeAutoOff.OFF)}
            ariaLabel="DSEE Extreme"
          />
        </Row>
      ))}

      {tr(pauseOnRemoval !== null && (
        <Row label="Pause when removed" hint="Stops playback when you take them off">
          <Switch checked={pauseOnRemoval} onChange={onPauseOnRemovalChange} ariaLabel="Pause when removed" />
        </Row>
      ))}

      {tr(headGesture !== null && (
        <Row label="Head gestures" hint="Nod to answer a call, shake to decline">
          <Switch checked={headGesture} onChange={onHeadGestureChange} ariaLabel="Head gestures" />
        </Row>
      ))}

      {tr(autoPowerOff !== null && (
        <Row label={isXm6 ? "Automatic power off" : "Switch off when idle"} hint={isXm6 ? "When enabled, turns off about 15 minutes after removal" : "Saves battery when you walk away"}>
          <div>
          <Segmented
            ariaLabel={isXm6 ? "Automatic power off" : "Switch off when idle"}
            value={autoPowerOff}
            onChange={onAutoPowerOffChange}
            options={powerOptions}
            disabled={autoPowerOffWrite === "pending"}
          />
          {!powerOptions.some((option) => option.value === autoPowerOff) && (
            <div role="status">{tr("Headphones reported a different auto power off state")}: 0x{autoPowerOff.toString(16).padStart(2, "0")}</div>
          )}
          {autoPowerOffWrite === "pending" && <div role="status">{tr("Checking headphone setting…")}</div>}
          {autoPowerOffWrite === "unconfirmed" && <div role="alert">{tr("Could not confirm the setting with the headphones.")}</div>}
          {autoPowerOffWrite === "rejected" && <div role="alert">{tr("Headphones did not accept the requested setting.")}</div>}
          </div>
        </Row>
      ))}

      {tr(speakToChat && (
        <>
          <Row label="Speak-to-Chat" hint="Pauses your music when you start talking">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Speak-to-Chat is reported switching itself back on, during meetings. Locking
                  it makes the app put it back whenever the headset changes it. */}
              {tr(onLockSpeakToChange && (
                <button
                  onClick={() => onLockSpeakToChange(speakToChatLocked ? undefined : speakToChat.enabled)}
                  aria-pressed={speakToChatLocked}
                  title={
                    tr(speakToChatLocked
                      ? "Locked — the app puts this back if the headphones change it"
                      : "Lock this setting")
                  }
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    padding: "5px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    color: speakToChatLocked ? "var(--accent)" : "var(--fg3)",
                    border: `1px solid ${speakToChatLocked ? "var(--accent)" : "var(--line)"}`,
                    background: "none",
                  }}
                >
                  {tr(speakToChatLocked ? "LOCKED" : "LOCK")}
                </button>
              ))}
              <Switch
                checked={speakToChat.enabled}
                onChange={(enabled) => onSpeakToChatChange({ ...speakToChat, enabled })}
                ariaLabel="Speak-to-Chat"
              />
            </div>
          </Row>
          <Collapse open={speakToChat.enabled} parentGap={16}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 16 }}>
              <Row label="Voice sensitivity" hint="How readily it decides you're speaking">
                <Segmented
                  ariaLabel="Voice sensitivity"
                  value={speakToChat.sensitivity}
                  onChange={(sensitivity) => onSpeakToChatChange({ ...speakToChat, sensitivity })}
                  options={[
                    { value: DetectSensitivity.AUTO, label: "AUTO" },
                    { value: DetectSensitivity.LOW, label: "LOW" },
                    { value: DetectSensitivity.HIGH, label: "HIGH" },
                  ]}
                />
              </Row>
              <Row label="Resume after" hint="Wait before your music comes back">
                <Segmented
                  ariaLabel="Resume after"
                  value={speakToChat.timeout}
                  onChange={(timeout) => onSpeakToChatChange({ ...speakToChat, timeout })}
                  options={[
                    { value: ModeOutTime.FAST, label: "SHORT" },
                    { value: ModeOutTime.MID, label: "STANDARD" },
                    { value: ModeOutTime.SLOW, label: "LONG" },
                    { value: ModeOutTime.NONE, label: "NEVER" },
                  ]}
                />
              </Row>
            </div>
          </Collapse>
        </>
      ))}
    </div>
  );
}
