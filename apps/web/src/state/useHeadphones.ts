import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, type HeadphonesState } from "@ssc/core";
import { WebSerialTransport } from "@ssc/transport-webserial";

/**
 * Turns a raw failure into something the person can act on. The cause matters a lot here:
 * "no port in the chooser" and "the headset refused the link" need completely different fixes,
 * so we never show a single canned explanation.
 */
export interface ConnectErrorHelp {
  headline: string;
  hint: string;
  /** Concrete things to try, most likely first. Rendered as a list, not prose. */
  steps?: string[];
  detail: string;
}

export function describeConnectError(err: unknown): ConnectErrorHelp {
  const detail = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";

  if (/No port selected/i.test(detail) || name === "NotFoundError") {
    return {
      headline: "No headphones showed up",
      hint: "Either the picker was dismissed, or Windows isn't offering the headset's control service.",
      steps: [
        "Check the headphones are connected in your Bluetooth settings, not only paired.",
        "Quit Nullpoint if it's running in your system tray, then try again.",
        "Turn the headphones off and on if they've been idle.",
      ],
      detail,
    };
  }
  if (name === "SecurityError" || /permission/i.test(detail)) {
    return {
      headline: "The browser blocked the connection",
      hint: "Serial access needs a secure page and your permission. On the web, use HTTPS and allow the device when prompted.",
      detail,
    };
  }
  if (name === "NetworkError" || /already open|failed to open|access denied/i.test(detail)) {
    return {
      headline: "Something else is holding the settings channel",
      // These are ordered by how often each one is actually the culprit — the copy of
      // Nullpoint you forgot is in the tray beats the phone you're thinking of.
      hint: "Your headphones take settings from one place at a time, even while playing audio to two devices.",
      steps: [
        "Quit Nullpoint in your system tray — the desktop app holds the channel while it runs.",
        "Close any other Nullpoint tab or window.",
        "Disconnect the headphones from your phone. Sony's app doesn't need to be open for the phone to be holding it.",
      ],
      detail,
    };
  }
  if (/Timed out|No ACK/i.test(detail)) {
    return {
      headline: "The headphones didn't answer",
      hint: "The link opened but the headset never replied, which usually means it powered itself off.",
      steps: [
        "Press the power button on the headphones and wait for them to reconnect.",
        "If they're already on, turn them off and on again.",
      ],
      detail,
    };
  }
  return {
    headline: "Couldn't reach your headphones",
    hint: "The connection failed before the headset could be read. Check that it's powered on and connected, then try again.",
    detail,
  };
}

export type ConnectionStatus =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "reconnecting"; reason: "busy" | "gone" }
  | { status: "failed"; message: string }
  | { status: "connected" };

// Reconnection keeps going for as long as the user lets it. Giving up after a handful of
// tries stranded people on a dead end that only a page refresh cleared, when the usual cause
// — a phone holding the control channel — resolves on its own minutes later.
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 15_000;
/**
 * Taking a busy channel back is a race, not a wait: you win it by asking at a moment the other
 * device isn't holding it. Backing off to fifteen seconds lost that race almost every time, so
 * this case keeps knocking.
 */
const RECONNECT_BUSY_MAX_MS = 2500;
/**
 * How many times to race before accepting the channel is genuinely occupied. "One socket open
 * every couple of seconds costs nothing" was wrong: it shares a radio with the audio, and a
 * successful attempt is a forty-frame handshake. Roughly fifteen seconds of racing catches the
 * device that grabbed the channel for a moment, which is the case worth winning.
 */
const BUSY_RACE_ATTEMPTS = 6;
/** Once it is clear something is holding on, check back at this interval instead of racing. */
const RECONNECT_BUSY_CALM_MS = 30_000;

/** The headset is reachable but its control channel is taken (see PROTOCOL.md, 0x2740). */
function isChannelBusy(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /failed to open|already open|access denied|NetworkError/i.test(text);
}

/**
 * Owns the connect lifecycle: pick a port (user gesture), open the Web Serial transport, run the
 * @ssc/core handshake, and expose live device state. Also owns reconnection: if the transport
 * reports "disconnected" (device powered off, went out of range — PLAN.md's design §5.3 rule 3
 * "one controller"/reconnecting state), retries against the *same* already-granted port without
 * needing a new user gesture, since Web Serial permission persists for a previously picked port.
 */
export function useHeadphones({ autoReconnect = true }: { autoReconnect?: boolean } = {}) {
  const supported = WebSerialTransport.isSupported();
  const [connection, setConnection] = useState<ConnectionStatus>(supported ? { status: "idle" } : { status: "unsupported" });
  const [deviceState, setDeviceState] = useState<HeadphonesState | null>(null);
  const [controlLost, setControlLost] = useState(false);
  const [grantedPorts, setGrantedPorts] = useState<SerialPort[] | null>(null);
  const [selection, setSelection] = useState<{ requestId: number; ports: Array<{ id: string; name: string }> } | null>(null);
  const headphonesRef = useRef<Headphones | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef<Promise<HeadphonesState> | null>(null);
  const cleanupRef = useRef<Promise<void>>(Promise.resolve());
  const attemptReconnectRef = useRef<(port: SerialPort) => void>(() => {});
  const autoReconnectRef = useRef(autoReconnect);
  autoReconnectRef.current = autoReconnect;

  useEffect(() => window.nullpoint?.onSerialPorts((value) => setSelection(value)), []);
  useEffect(() => {
    if (!supported || connection.status !== "idle") return;
    let active = true;
    setGrantedPorts(null);
    void WebSerialTransport.grantedPorts().then((ports) => { if (active) setGrantedPorts(ports); });
    return () => { active = false; };
  }, [supported, connection.status]);

  // Drain a cancelled handshake before reusing its port. Closing while open() is still pending
  // alone is insufficient: the open can finish later and leave a live, orphaned transport.
  const retire = useCallback(() => {
    const previous = headphonesRef.current;
    const pending = inFlightRef.current;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    headphonesRef.current = null;
    inFlightRef.current = null;
    if (previous) {
      cleanupRef.current = cleanupRef.current.then(async () => {
        await previous.disconnect().catch(() => undefined);
        if (pending) await pending.catch(() => undefined);
        await previous.disconnect().catch(() => undefined);
      });
    }
  }, []);

  const establish = useCallback(async (port: SerialPort, generation: number): Promise<HeadphonesState> => {
    retire();
    await cleanupRef.current;
    if (generation !== generationRef.current) throw new Error("Connection cancelled");
    const headphones = new Headphones(new WebSerialTransport(port));
    headphonesRef.current = headphones;
    let linked = false;
    setControlLost(false);
    unsubscribeRef.current = headphones.on((event) => {
      if (generation !== generationRef.current || headphonesRef.current !== headphones) return;
      setDeviceState({ ...headphones.state });
      if (event.type === "controlLost") setControlLost(true);
      if (event.type === "controlRegained") setControlLost(false);
      if (event.type !== "disconnected" || !linked) return;
      if (autoReconnectRef.current) attemptReconnectRef.current(port);
      else setConnection({ status: "failed", message: "The headphones disconnected." });
    });
    const pending = headphones.connect();
    inFlightRef.current = pending;
    try {
      const state = await pending;
      if (generation !== generationRef.current) throw new Error("Connection cancelled");
      linked = true;
      return state;
    } catch (error) {
      if (headphonesRef.current === headphones) {
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        headphonesRef.current = null;
      }
      await headphones.disconnect().catch(() => undefined);
      throw error;
    } finally {
      if (inFlightRef.current === pending) inFlightRef.current = null;
    }
  }, [retire]);

  const attemptReconnect = useCallback(async (port: SerialPort) => {
    const generation = ++generationRef.current;
    let reason: "busy" | "gone" = "gone";
    let delay = RECONNECT_BASE_MS;
    let busyAttempts = 0;
    setConnection({ status: "reconnecting", reason });
    while (generation === generationRef.current) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (generation !== generationRef.current) return;
      try {
        const state = await establish(port, generation);
        if (generation !== generationRef.current) return;
        setDeviceState(state);
        setConnection({ status: "connected" });
        return;
      } catch (error) {
        if (generation !== generationRef.current) return;
        const next = isChannelBusy(error) ? "busy" : "gone";
        if (next !== reason) { delay = RECONNECT_BASE_MS; busyAttempts = 0; }
        reason = next;
        setConnection({ status: "reconnecting", reason });
        if (reason === "busy") {
          busyAttempts += 1;
          delay = busyAttempts <= BUSY_RACE_ATTEMPTS
            ? Math.min(Math.round(delay * 1.25), RECONNECT_BUSY_MAX_MS)
            : Math.min(Math.round(delay * 1.6), RECONNECT_BUSY_CALM_MS);
        } else delay = Math.min(Math.round(delay * 1.6), RECONNECT_MAX_MS);
      }
    }
  }, [establish]);
  attemptReconnectRef.current = attemptReconnect;

  const reconnectKnown = useCallback(async () => {
    const generation = ++generationRef.current;
    setConnection({ status: "connecting" });
    setControlLost(false);
    const ports = await WebSerialTransport.grantedPorts();
    let lastError: unknown = new Error("No previously connected headphones are reachable.");
    for (const port of ports) {
      if (generation !== generationRef.current) return;
      try {
        const state = await establish(port, generation);
        if (generation !== generationRef.current) return;
        setDeviceState(state);
        setConnection({ status: "connected" });
        return;
      } catch (error) { lastError = error; }
    }
    if (generation === generationRef.current) setConnection({
      status: "failed", message: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }, [establish]);

  const choosePort = useCallback(async () => {
    const generation = ++generationRef.current;
    setConnection({ status: "connecting" });
    setControlLost(false);
    try {
      // This call is made synchronously in the click handler to preserve browser user activation.
      const port = await WebSerialTransport.pickPort();
      if (generation !== generationRef.current) return;
      setSelection(null);
      setGrantedPorts((current) => current?.includes(port) ? current : [...(current ?? []), port]);
      const state = await establish(port, generation);
      if (generation !== generationRef.current) return;
      setDeviceState(state);
      setConnection({ status: "connected" });
    } catch (error) {
      if (generation !== generationRef.current) return;
      setSelection(null);
      setConnection({ status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, [establish]);

  const connect = useCallback(() => {
    if (grantedPorts === null) return;
    if (grantedPorts.length) void reconnectKnown();
    else void choosePort();
  }, [grantedPorts, reconnectKnown, choosePort]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    window.nullpoint?.cancelSerialPort(null);
    setSelection(null);
    setControlLost(false);
    setConnection({ status: "idle" });
    setDeviceState(null);
    retire();
  }, [retire]);

  useEffect(() => () => {
    generationRef.current += 1;
    window.nullpoint?.cancelSerialPort(null);
    retire();
  }, [retire]);

  return { connection, deviceState, controlLost, connect, reconnectKnown, choosePort, grantedPorts, reset,
    selection, selectPort: (requestId: number, id: string) => {
      window.nullpoint?.selectSerialPort(requestId, id);
    }, headphones: headphonesRef.current };
}
