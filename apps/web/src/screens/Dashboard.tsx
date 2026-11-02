import { useEffect, useRef, type ComponentProps } from "react";
import { AmbientSoundMode, BatteryChargingStatus, EqPresetId, FunctionTypeT1, noiseModeFromState, type EqBands, type Headphones, type HeadphonesState } from "@ssc/core";
import { tr } from "../i18n.js";
import { customEqKey, type EqProfile } from "../state/useSettings.js";
import { TitleBar } from "./TitleBar.js";
import { DeviceArt } from "../components/DeviceArt.js";
import { ConnectedDevices } from "../components/ConnectedDevices.js";
import { SoundSettings } from "../components/SoundSettings.js";
import { NowPlaying } from "../components/NowPlaying.js";
import { NoiseModeSegmented } from "../components/NoiseModeSegmented.js";
import { ListeningModePanel } from "../components/ListeningModePanel.js";
import { AmbientLevelSlider } from "../components/AmbientLevelSlider.js";
import { EqualizerPanel } from "../components/EqualizerPanel.js";
import xm6Image from "../landing/xm6.png";

export function Dashboard({
  state, headphones, onSettingsClick, reconnecting, reconnectReason = "gone", controlLost = false,
  savedCustomEq, onCustomEqChange, eqProfiles = [], speakToChatLocked, onLockSpeakToChange,
  onSaveEqProfile, onDeleteEqProfile, onCancelReconnect,
}: {
  state: HeadphonesState;
  headphones: Headphones;
  onSettingsClick: () => void;
  reconnecting: boolean;
  reconnectReason?: "busy" | "gone";
  controlLost?: boolean;
  savedCustomEq?: Record<string, number[]>;
  onCustomEqChange?: (key: string, values: number[]) => void;
  eqProfiles?: EqProfile[];
  speakToChatLocked?: boolean;
  onLockSpeakToChange?: (value: boolean | undefined) => void;
  onSaveEqProfile?: (name: string, bands: EqBands) => void;
  onDeleteEqProfile?: (id: string) => void;
  onCancelReconnect: () => void;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.inert = reconnecting || controlLost;
  }, [reconnecting, controlLost]);

  const ncAsm = state.ncAsm;
  const battery = state.battery;
  const isXm6 = state.modelName?.trim().toUpperCase() === "WH-1000XM6";
  const eqProps: ComponentProps<typeof EqualizerPanel> | null = state.eq ? {
    preset: state.eq.preset, bands: state.eq.bands, profiles: eqProfiles,
    onPresetChange: (preset) => {
      const layout = state.eq?.bands?.layout;
      const saved = layout ? savedCustomEq?.[customEqKey(state.modelName, layout)] : undefined;
      const restore = preset === EqPresetId.CUSTOM && saved && layout ? { layout, values: saved } : undefined;
      void headphones.setEqPreset(preset, restore);
    },
    onBandChange: (index, value) => {
      const current = state.eq?.bands;
      if (!current) return;
      const values = [...current.values];
      values[index] = value;
      onCustomEqChange?.(customEqKey(state.modelName, current.layout), values);
      void headphones.setEqBands({ ...current, values });
    },
    onApplyProfile: (profile) => {
      const bands = { layout: profile.layout as EqBands["layout"], values: profile.values };
      onCustomEqChange?.(customEqKey(state.modelName, bands.layout), profile.values);
      void headphones.setEqPreset(EqPresetId.CUSTOM, bands);
    },
    onSaveProfile: onSaveEqProfile ?? (() => {}),
    onDeleteProfile: onDeleteEqProfile ?? (() => {}),
  } : null;
  const soundProps: ComponentProps<typeof SoundSettings> = {
    modelName: state.modelName, connectionMode: state.connectionMode, upscaling: state.upscaling,
    speakToChat: state.speakToChatLoading ? null : state.speakToChat,
    pauseOnRemoval: state.pauseOnRemoval, headGesture: state.headGesture,
    autoPowerOff: state.autoPowerOff, autoPowerOffWrite: state.autoPowerOffWrite,
    onConnectionModeChange: (mode) => void headphones.setConnectionMode(mode),
    onUpscalingChange: (value) => void headphones.setUpscaling(value),
    onSpeakToChatChange: (next) => void headphones.setSpeakToChat(next),
    speakToChatLocked, onLockSpeakToChange,
    onPauseOnRemovalChange: (enabled) => void headphones.setPauseOnRemoval(enabled),
    onHeadGestureChange: (enabled) => void headphones.setHeadGesture(enabled),
    onAutoPowerOffChange: (value) => void headphones.setAutoPowerOff(value),
  };
  const ambientProps: ComponentProps<typeof AmbientLevelSlider> | null = ncAsm ? {
    active: noiseModeFromState(ncAsm) === "ambient", level: ncAsm.ambientLevel,
    focusOnVoice: ncAsm.ambientMode === AmbientSoundMode.VOICE, autoAmbient: ncAsm.autoAmbient,
    onLevelChange: (level) => void headphones.setAmbientLevel(level),
    onFocusOnVoiceChange: (enabled) => void headphones.setFocusOnVoice(enabled),
    onAutoAmbientChange: (enabled, sensitivity) => void headphones.setAutoAmbient(enabled, sensitivity),
  } : null;
  const hasMore = Boolean(eqProps || state.pairedDevices || ncAsm?.autoAmbient ||
    state.connectionMode !== null || state.upscaling !== null || state.headGesture !== null ||
    (!state.speakToChatLoading && state.speakToChat !== null) || state.pauseOnRemoval !== null || state.autoPowerOff !== null);
  const supports = (feature: FunctionTypeT1) => state.supportedFunctions.has(feature);
  const listeningReadFailed =
    ((supports(FunctionTypeT1.LISTENING_OPTION) || supports(FunctionTypeT1.BGM_MODE_SMALL_MIDDLE_LARGE_AND_ERRORCODE)) && state.bgmMode === null) ||
    (supports(FunctionTypeT1.UPMIX_CINEMA) && state.upmixCinema === null) ||
    (supports(FunctionTypeT1.UPMIX_SERIES) && state.upmixSeries === null);

  return <div className="screen app-shell">
    <TitleBar onSettingsClick={onSettingsClick} />
    {reconnecting && <div className="status-banner" role="status">
      <span>{tr(reconnectReason === "busy"
        ? "Another device is holding the settings channel — taking it back. Your music is unaffected. If it doesn't return, disconnect the headphones from your phone."
        : "Connection lost. Reconnecting…")}</span>
      <button className="secondary-button" onClick={onCancelReconnect}>{tr("Cancel")}</button>
    </div>}
    {controlLost && !reconnecting && <div className="status-banner" role="status">
      {tr("Your headphones stopped answering — taking the settings channel back. If your phone is connected, it may be holding it.")}
    </div>}
    <main className="dashboard-scroll">
      <div className="dashboard-grid measure">
        <aside className="device-panel">
          <div className="device-image">
            {isXm6
              ? <img src={xm6Image} alt={tr("WH-1000XM6 illustration")} />
              : <DeviceArt model={state.modelName} size="70%" />}
          </div>
          <div className="device-details">
            <h1>{state.modelName ?? tr("Unknown model")}</h1>
            <p className="device-status"><span className="status-dot" />{tr(reconnecting ? "Reconnecting" : controlLost ? "No control" : "Connected")}</p>
            {battery && <div className="device-battery">
              <div><span>{tr("Battery")}</span><strong>{battery.level}%</strong>
                {battery.charging === BatteryChargingStatus.CHARGING && <span>{tr("CHARGING")}</span>}
              </div>
              <div className="battery-track"><span style={{ width: Math.max(0, Math.min(100, battery.level)) + "%" }} /></div>
            </div>}
          </div>
        </aside>
        <div className="dashboard-controls" ref={controlsRef} aria-disabled={reconnecting || controlLost}>
          {ncAsm && <section className="dashboard-panel noise-panel">
            <h2>{tr("NOISE CONTROL")}</h2>
            <NoiseModeSegmented value={noiseModeFromState(ncAsm)} onChange={(mode) => void headphones.setNoiseMode(mode)} />
            {ambientProps && <AmbientLevelSlider {...ambientProps} section="basic" />}
          </section>}
          {state.settingsLoading && <p className="dashboard-loading" role="status">{tr("Loading additional settings…")}</p>}
          {!state.listeningSettingsLoading && (listeningReadFailed
            ? <section className="dashboard-panel"><h2>{tr("Listening mode")}</h2>
                <p className="listening-error" role="status">{tr("Could not read all listening settings. Reconnect to try again.")}</p></section>
            : <ListeningModePanel headphones={headphones} bgmMode={state.bgmMode}
                upmixCinema={state.upmixCinema} upmixSeries={state.upmixSeries} writeStatus={state.listeningModeWrite} />)}
          {eqProps && <EqualizerPanel {...eqProps} section="presets" />}
          <NowPlaying playback={state.playback} volume={state.volume} codec={state.codec}
            onPlayPause={() => void headphones.playPause()} onNext={() => void headphones.nextTrack()}
            onPrevious={() => void headphones.previousTrack()} onVolumeChange={(level) => void headphones.setVolume(level)} />
          {hasMore && <details className="more-controls">
            <summary>{tr("More features")}</summary>
            <div className="more-controls-content">
              {eqProps && <EqualizerPanel {...eqProps} section="details" />}
              {ambientProps?.autoAmbient && <section className="dashboard-panel">
                <h2>{tr("AMBIENT SOUND ADVANCED")}</h2><AmbientLevelSlider {...ambientProps} section="advanced" />
              </section>}
              <SoundSettings {...soundProps} />
              {state.pairedDevices && <ConnectedDevices devices={state.pairedDevices}
                onSetConnection={(address, connect) => headphones.setDeviceConnection(address, connect)}
                onSwitchAudio={(address) => headphones.switchAudioTo(address)} />}
            </div>
          </details>}
        </div>
      </div>
    </main>
  </div>;
}
