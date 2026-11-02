/* Test-only serial and desktop bridge. This entry is not part of Vite's production inputs. */
import { AudioInquiredType, CommandT1, CommandT2, DataType, EnableDisable, decodeFrameBody, packageDataForBt } from "@ssc/core";
import { createFakeDevice } from "./fake-device";
import { DEFAULT_SETTINGS } from "../src/state/useSettings";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "picker";
const model = params.get("model") ?? "WH-1000XM6";
const extras = params.get("extras") !== "false";
const powerBehavior = params.get("power") as "accept" | "reject" | "malformed" | null;
const device = createFakeDevice({ model, extras, quickOnly: params.get("quickOnly") === "true",
  initialBothModes: params.get("initialModes") === "both",
  table2: params.get("table2") === "true", upmixSeries: params.get("upmixSeries") === "true",
  autoPowerOffBehavior: powerBehavior ?? "accept" });
let serialListener: ((event: { target: unknown }) => void) | null = null;
let notifyPorts: ((value: unknown) => void) | null = null;
let selectResolve: ((port: FakePort) => void) | null = null;
let selectReject: ((error: Error) => void) | null = null;
let savedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("test.settings") ?? "{}") };
let savedListeners: Array<(settings: typeof savedSettings) => void> = [];
let pickCount = 0;
let releaseOpen: (() => void) | null = null;
let closes = 0;
let opens = 0;
const audioWrites: number[][] = [];
let listeningWriteSeen = false;
const commandWrites: number[] = [];
let firstExtraHeld = false;
let releaseFirstExtra: (() => void) | null = null;
let pairReadHeld = false;
const wireWrites: Array<{ type: number; command: number }> = [];
const extraCommands = new Set<number>([
  CommandT1.AUDIO_GET_PARAM, CommandT1.SYSTEM_GET_PARAM, CommandT1.SYSTEM_GET_EXT_PARAM,
  CommandT1.POWER_GET_PARAM, CommandT1.COMMON_GET_STATUS, CommandT1.PLAY_GET_STATUS,
  CommandT1.PLAY_GET_PARAM,
]);

class FakePort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  constructor(public id: string, public name: string, private fails = false) {}
  async open() {
    if (this.fails) throw new Error("failed to open: simulated port unavailable");
    if (scenario === "late") await new Promise<void>((resolve) => { releaseOpen = resolve; });
    opens++;
    this.readable = new ReadableStream({ start: (controller) => { this.controller = controller; } });
    this.writable = new WritableStream({ write: (data) => {
      const decoded = decodeFrameBody(data.subarray(1, data.length - 1));
      const command = decoded.payload[0];
      if (decoded.dataType === DataType.DATA_MDR && command !== undefined) commandWrites.push(command);
      if ((decoded.dataType === DataType.DATA_MDR || decoded.dataType === DataType.DATA_MDR_NO2) && command !== undefined) {
        wireWrites.push({ type: decoded.dataType, command });
      }
      if (decoded.dataType === DataType.DATA_MDR && command === CommandT1.AUDIO_SET_PARAM) {
        audioWrites.push(Array.from(decoded.payload));
        if (decoded.payload[1] === AudioInquiredType.BGM_MODE_AND_ERRORCODE || decoded.payload[1] === AudioInquiredType.UPMIX_CINEMA) listeningWriteSeen = true;
        if (params.get("drop") === "bgm-disable" &&
          decoded.payload[1] === AudioInquiredType.BGM_MODE_AND_ERRORCODE && decoded.payload[2] === EnableDisable.DISABLE) return;
        if (params.get("drop") === "cinema-enable" &&
          decoded.payload[1] === AudioInquiredType.UPMIX_CINEMA && decoded.payload[2] === EnableDisable.ENABLE) return;
        if (params.get("reject") === "cinema-enable" &&
          decoded.payload[1] === AudioInquiredType.UPMIX_CINEMA && decoded.payload[2] === EnableDisable.ENABLE) {
          queueMicrotask(() => { try { this.controller?.enqueue(packageDataForBt(DataType.ACK, 1 - decoded.seq, new Uint8Array(0))); } catch { /* closed */ } });
          return;
        }
      }
      let responses = device(data);
      if (params.get("skipCinemaRead") === "true" && command === CommandT1.AUDIO_GET_PARAM &&
        decoded.payload[1] === AudioInquiredType.UPMIX_CINEMA) responses = responses.slice(0, 1);
      if (params.get("skipReadAfterWrite") === "true" && listeningWriteSeen && command === CommandT1.AUDIO_GET_PARAM &&
        decoded.payload[1] === AudioInquiredType.BGM_MODE_AND_ERRORCODE) responses = responses.slice(0, 1);
      const reply = () => responses.forEach((frame) => { try { this.controller?.enqueue(frame); } catch { /* closed */ } });
      if (params.get("holdPairRead") === "true" && decoded.dataType === DataType.DATA_MDR_NO2 &&
        command === CommandT2.PERI_GET_PARAM && !pairReadHeld) {
        pairReadHeld = true;
        return;
      }
      if (command !== undefined && extraCommands.has(command) && params.get("holdFirstExtra") === "true" && !firstExtraHeld) {
        firstExtraHeld = true;
        releaseFirstExtra = reply;
        return;
      }
      const extraDelay = Number(params.get("delayExtras") ?? "0");
      if (command !== undefined && extraCommands.has(command) && extraDelay > 0) {
        setTimeout(reply, extraDelay);
        return;
      }
      if (command === CommandT1.POWER_SET_PARAM) setTimeout(reply, 250);
      else queueMicrotask(reply);
    } });
  }
  async close() {
    closes++;
    try { this.controller?.close(); } catch { /* cancelled */ }
    this.controller = null; this.readable = null; this.writable = null;
  }
  getInfo() { return {}; }
}
const good = new FakePort("mock-good", "System headset");
const bad = new FakePort("mock-bad", "Unavailable port", true);
let ports = scenario === "known" || scenario === "late" ? [good] : scenario === "known-mixed" ? [bad, good] : scenario === "failed" ? [bad] : [];
let offered = [good];
const serial = {
  getPorts: async () => ports,
  requestPort: () => {
    pickCount++;
    return new Promise<FakePort>((resolve, reject) => {
      selectResolve = resolve; selectReject = reject;
      setTimeout(() => notifyPorts?.({ requestId: pickCount, ports: offered.map((p) => ({ id: p.id, name: p.name })) }), 0);
    });
  },
  addEventListener: (_type: string, listener: typeof serialListener) => { serialListener = listener; },
  removeEventListener: () => { serialListener = null; },
};
Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
(window as any).nullpoint = {
  isDesktop: true,
  getSettings: async () => savedSettings,
  setSettings: async (patch: object) => {
    savedSettings = { ...savedSettings, ...patch };
    localStorage.setItem("test.settings", JSON.stringify(savedSettings));
    savedListeners.forEach((listener) => listener(savedSettings));
    return savedSettings;
  },
  onSettingsChanged: (callback: (settings: typeof savedSettings) => void) => {
    savedListeners.push(callback); return () => { savedListeners = savedListeners.filter((fn) => fn !== callback); };
  },
  onHotkey: () => () => {},
  reportDeviceState: () => {},
  onSerialPorts: (callback: (value: unknown) => void) => { notifyPorts = callback; return () => { notifyPorts = null; }; },
  selectSerialPort: (requestId: number, id: string) => {
    if (requestId !== pickCount) return;
    const port = offered.find((item) => item.id === id);
    if (port && selectResolve) { ports = [port]; selectResolve(port); selectResolve = null; selectReject = null; }
  },
  cancelSerialPort: () => {
    if (selectReject) { selectReject(new DOMException("No port selected by the user", "NotFoundError")); selectResolve = null; selectReject = null; }
  },
};
(window as any).__mock = {
  disconnect: () => serialListener?.({ target: good }),
  portCount: () => pickCount,
  releaseOpen: () => releaseOpen?.(),
  closes: () => closes,
  opens: () => opens,
  isOpen: () => good.readable !== null || good.writable !== null,
  audioWrites: () => audioWrites,
  commandWrites: () => commandWrites,
  wireWrites: () => wireWrites,
  pairReadHeld: () => pairReadHeld,
  firstExtraHeld: () => firstExtraHeld,
  releaseFirstExtra: () => { const reply = releaseFirstExtra; releaseFirstExtra = null; reply?.(); },
  setOffered: (items: Array<{ id: string; name: string }>) => {
    offered = items.map((item) => new FakePort(item.id, item.name));
    notifyPorts?.({ requestId: pickCount, ports: offered.map((p) => ({ id: p.id, name: p.name })) });
  },
};
await import("../src/main");
