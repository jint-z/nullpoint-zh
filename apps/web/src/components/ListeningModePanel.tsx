import { useRef, useState } from "react";
import { HiOutlineFilm, HiOutlineMusicalNote, HiOutlineSpeakerWave } from "react-icons/hi2";
import { RoomSize, UpmixItem, type BgmModeState, type Headphones, type ListeningMode, type ListeningWriteStatus } from "@ssc/core";
import { tr } from "../i18n.js";
import { Segmented } from "./Segmented.js";

export function ListeningModePanel({ headphones, bgmMode, upmixCinema, upmixSeries, writeStatus }: {
  headphones: Headphones;
  bgmMode: BgmModeState | null;
  upmixCinema: boolean | null;
  upmixSeries: UpmixItem | null;
  writeStatus: ListeningWriteStatus;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"rejected" | "unconfirmed" | null>(null);
  const hasModes = bgmMode !== null || upmixCinema !== null;

  async function run(action: () => Promise<ListeningWriteStatus | void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await action();
      if (result === "rejected" || result === "unconfirmed") setFailure(result);
    } catch {
      setFailure("unconfirmed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function selectMode(mode: ListeningMode) {
    void run(() => headphones.setListeningMode(mode));
  }

  if (!hasModes && upmixSeries === null) return null;

  const modes = [
    ...(bgmMode ? [{ id: "background" as const, label: "Background music", Icon: HiOutlineMusicalNote, selected: bgmMode.enabled }] : []),
    ...(upmixCinema !== null ? [{ id: "cinema" as const, label: "Cinema upmix", Icon: HiOutlineFilm, selected: upmixCinema }] : []),
    ...(hasModes ? [{ id: "standard" as const, label: "Standard", Icon: HiOutlineSpeakerWave, selected: !bgmMode?.enabled && !upmixCinema }] : []),
  ];

  const pending = busy || writeStatus === "pending";
  return <section className="dashboard-panel listening-panel" aria-busy={pending}>
    <h2>{tr("Listening mode")}</h2>
    {hasModes && <div className="noise-modes listening-modes" role="group" aria-label={tr("Listening mode")}>
      {modes.map(({ id, label, Icon, selected }) => <button key={id} type="button" className="noise-mode"
        aria-pressed={selected} disabled={pending} onClick={() => selectMode(id)}>
        <span className="noise-mode-circle" aria-hidden="true"><Icon /></span>
        <span>{tr(label)}</span>
      </button>)}
    </div>}
    {bgmMode?.enabled && <div className="listening-detail">
      <div>
        <div>{tr("Room size")}</div>
        <small>{tr("How far away it sounds")}</small>
      </div>
      <Segmented ariaLabel="Room size" value={bgmMode.room} disabled={pending}
        onChange={(room) => void run(() => headphones.setListeningRoom(room))}
        options={[
          { value: RoomSize.SMALL, label: "SMALL" },
          { value: RoomSize.MIDDLE, label: "MEDIUM" },
          { value: RoomSize.LARGE, label: "LARGE" },
        ]} />
    </div>}
    {upmixSeries !== null && <div className="listening-detail">
      <div>
        <div>{tr("Spatial upmix")}</div>
        <small>{tr("Spreads a stereo mix out around you")}</small>
      </div>
      <Segmented ariaLabel="Spatial upmix" value={upmixSeries} disabled={pending}
        onChange={(item) => void run(async () => {
          await headphones.setUpmixSeries(item);
          if (headphones.state.upmixSeries !== item) throw new Error("Spatial upmix write failed");
        })}
        options={[
          { value: UpmixItem.NONE, label: "OFF" },
          { value: UpmixItem.MUSIC, label: "MUSIC" },
          { value: UpmixItem.CINEMA, label: "CINEMA" },
          { value: UpmixItem.GAME, label: "GAME" },
        ]} />
    </div>}
    {pending && <p className="listening-status" role="status">{tr("Checking listening setting…")}</p>}
    {failure && <p className="listening-error" role="alert">{tr(failure === "rejected"
      ? "Headphones did not accept the listening setting."
      : "Could not confirm the listening setting. Please try again.")}</p>}
  </section>;
}
