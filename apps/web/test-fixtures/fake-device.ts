import { decodeFrameBody, packageDataForBt } from "@ssc/core";
import { MAX_VOLUME, codecLabel } from "@ssc/core";
import { labelFrame } from "@ssc/core";
import {
  CommandT1,
  CommandT2,
  ConnectInquiredType,
  ConnectivityActionType,
  SourceSwitchResult,
  AudioInquiredType,
  AudioCodec,
  AutoPowerOff,
  CommonInquiredType,
  PlayInquiredType,
  PlaybackControl,
  PlaybackStatus,
  RoomSize,
  SystemInquiredType,
  EnableDisable,
  FunctionTypeT1,
  PriorMode,
  UpscalingTypeAutoOff,
  UpmixItem,
  DetectSensitivity,
  ModeOutTime,
  DataType,
  DeviceInfoType,
  PeripheralInquiredType,
  PowerInquiredType,
  PowerOffSettingValue,
  BatteryChargingStatus,
  NcAsmInquiredType,
  OnOff,
  NcAsmMode,
  NoiseAdaptiveSensitivity,
  AmbientSoundMode,
  ValueChangeStatus,
  EqEbbInquiredType,
  EqPresetId,
} from "@ssc/core";

function textBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function ack(seq = 0): Uint8Array {
  return packageDataForBt(DataType.ACK, seq, Uint8Array.from([]));
}

/**
 * One device record as the headset lays it out: address, multipoint slot, 24-bit CoD, name.
 * `slot` is 0 when the device is merely paired, otherwise which of the two multipoint slots
 * it occupies.
 */
function pairedDeviceRecord(address: string, slot: number, cod: number, name: string): number[] {
  const nameBytes = textBytes(name);
  return [
    ...textBytes(address),
    slot,
    (cod >> 16) & 0xff,
    (cod >> 8) & 0xff,
    cod & 0xff,
    nameBytes.length,
    ...nameBytes,
  ];
}

const IPHONE = "AA:BB:CC:DD:EE:01";
const THINKPAD = "AA:BB:CC:DD:EE:02";

/**
 * A fake WH-1000XM6 that answers the v1 connect handshake and feature gets.
 *
 * It remembers what it was told, because the client reads state back after every write — a
 * stateless stub would report defaults and make correct code look broken.
 *
 * @param table2 whether to advertise and answer Protocol V2 Table 2. Off by default, so the
 * majority of tests exercise the same path a device without it takes.
 */
export function createFakeDevice({
  model = "WH-1000XM6",
  table2 = false,
  noiseAdaptation = false,
  extras = false,
  quickOnly = false,
  initialBothModes = false,
  upmixSeries = false,
  autoPowerOffBehavior = "accept",
}: {
  model?: string;
  table2?: boolean;
  noiseAdaptation?: boolean;
  extras?: boolean;
  quickOnly?: boolean;
  initialBothModes?: boolean;
  /** The spatial-upmix picker, which some headsets offer in place of the cinema toggle. */
  upmixSeries?: boolean;
  autoPowerOffBehavior?: "accept" | "reject" | "malformed";
} = {}) {
  const ncAsmType = noiseAdaptation
    ? NcAsmInquiredType.MODE_NC_ASM_DUAL_NC_MODE_SWITCH_AND_ASM_SEAMLESS_NA
    : NcAsmInquiredType.MODE_NC_ASM_DUAL_NC_MODE_SWITCH_AND_ASM_SEAMLESS;
  const state = {
    ncAsm: {
      onOff: OnOff.ON as number,
      mode: NcAsmMode.NC as number,
      ambientMode: AmbientSoundMode.NORMAL as number,
      level: 12,
      autoOn: OnOff.OFF as number,
      sensitivity: NoiseAdaptiveSensitivity.STANDARD as number,
    },
    connectionMode: PriorMode.SOUND_QUALITY as number,
    upscaling: UpscalingTypeAutoOff.OFF as number,
    stcEnabled: false,
    stcSensitivity: DetectSensitivity.AUTO as number,
    stcTimeout: ModeOutTime.MID as number,
    pauseOnRemoval: true,
    poweredOff: false,
    headGesture: false,
    autoPowerOff: AutoPowerOff.AFTER_30_MIN as number,
    autoPowerOffSetAttempted: false,
    bgmEnabled: initialBothModes,
    bgmRoom: RoomSize.MIDDLE as number,
    upmixCinema: initialBothModes,
    upmixSeries: UpmixItem.NONE as number,
    codec: AudioCodec.LDAC as number,
    playing: false,
    volume: 12,
    eqPreset: EqPresetId.CUSTOM as number,
    eqSteps: [13, 12, 10, 8, 13, 15],
    // Which paired devices are currently connected. Mutated by connect/disconnect so the
    // read-back that follows reports what actually happened.
    connected: new Set([IPHONE]),
    /** Which address currently holds the playback right. */
    playbackAddress: IPHONE as string,
  };

  /** Whichever NC/ASM shape this fake speaks — the noise-adaptation one carries two more bytes. */
  const ncAsmFrame = (command: CommandT1) => [
    command,
    ncAsmType,
    ValueChangeStatus.CHANGED,
    state.ncAsm.onOff,
    state.ncAsm.mode,
    state.ncAsm.ambientMode,
    state.ncAsm.level,
    ...(noiseAdaptation ? [state.ncAsm.autoOn, state.ncAsm.sensitivity] : []),
  ];

  const deviceList = () => [
    pairedDeviceRecord(IPHONE, state.connected.has(IPHONE) ? 1 : 0, 0x5a020c, "Mehrshad's iPhone"),
    // Slot 2, so a second multipoint device is not mistaken for a disconnected one.
    pairedDeviceRecord(THINKPAD, state.connected.has(THINKPAD) ? 2 : 0, 0x0c0104, "ThinkPad"),
  ];

  return (sent: Uint8Array) => {
    const { dataType, payload, seq } = decodeFrameBody(sent.subarray(1, sent.length - 1));
    if (dataType === DataType.ACK) return [];
    const command = payload[0] as CommandT1;
    const replies: Uint8Array[] = [ack(1 - seq)];
    const mdr = (bytes: number[]) => packageDataForBt(DataType.DATA_MDR, 0, Uint8Array.from(bytes));
    const mdr2 = (bytes: number[]) => packageDataForBt(DataType.DATA_MDR_NO2, 0, Uint8Array.from(bytes));

    if (dataType === DataType.DATA_MDR_NO2) {
      // Two inquired types share this frame: the device list, and moving the audio.
      const type = payload[1];
      if (
        type !== PeripheralInquiredType.PAIRING_DEVICE_MANAGEMENT_WITH_BLUETOOTH_CLASS_OF_DEVICE &&
        type !== PeripheralInquiredType.SOURCE_SWITCH_CONTROL
      ) {
        return replies;
      }
      if (command === (CommandT2.PERI_GET_PARAM as number)) {
        const list = deviceList();
        replies.push(
          mdr2([
            CommandT2.PERI_RET_PARAM,
            PeripheralInquiredType.PAIRING_DEVICE_MANAGEMENT_WITH_BLUETOOTH_CLASS_OF_DEVICE,
            list.length,
            ...list.flat(),
            // The slot of whichever device currently holds the audio.
            state.playbackAddress === IPHONE ? 1 : 2,
          ])
        );
      }
      if (
        command === (CommandT2.PERI_SET_EXTENDED_PARAM as number) &&
        payload[1] === PeripheralInquiredType.SOURCE_SWITCH_CONTROL
      ) {
        const address = new TextDecoder().decode(payload.subarray(2, 19));
        state.playbackAddress = address;
        replies.push(
          mdr2([
            CommandT2.PERI_NTFY_EXTENDED_PARAM,
            PeripheralInquiredType.SOURCE_SWITCH_CONTROL,
            SourceSwitchResult.SUCCESS,
            ...textBytes(address),
          ])
        );
        return replies;
      }
      if (command === (CommandT2.PERI_SET_EXTENDED_PARAM as number)) {
        const action = payload[2]!;
        const address = new TextDecoder().decode(payload.subarray(3, 20));
        if (action === ConnectivityActionType.CONNECT) state.connected.add(address);
        else state.connected.delete(address);
        replies.push(
          mdr2([
            CommandT2.PERI_NTFY_EXTENDED_PARAM,
            PeripheralInquiredType.PAIRING_DEVICE_MANAGEMENT_WITH_BLUETOOTH_CLASS_OF_DEVICE,
            action,
            // High nibble repeats the action, low nibble is the outcome.
            action === ConnectivityActionType.CONNECT ? 0x10 : 0x00,
            ...textBytes(address),
          ])
        );
      }
      return replies;
    }

    switch (command) {
      case CommandT1.CONNECT_GET_PROTOCOL_INFO:
        // payload[7] === 0 means "supports Table 2"; anything else means it does not.
        replies.push(
          mdr([CommandT1.CONNECT_RET_PROTOCOL_INFO, ConnectInquiredType.FIXED_VALUE, 0, 0, 0, 2, 0, table2 ? 0 : 1])
        );
        break;
      case CommandT1.CONNECT_GET_DEVICE_INFO: {
        const type = payload[1] as DeviceInfoType;
        const bytes = textBytes(type === DeviceInfoType.MODEL_NAME ? model : "2.0.1");
        replies.push(mdr([CommandT1.CONNECT_RET_DEVICE_INFO, type, bytes.length, ...bytes]));
        break;
      }
      case CommandT1.CONNECT_GET_SUPPORT_FUNCTION: {
        const functions = [
          FunctionTypeT1.BATTERY_LEVEL_INDICATOR,
          // A real WH-1000XM6 on FW 3.1.5 advertises 0x6D and *not* 0x6B.
          noiseAdaptation ? 0x6d : 0x6b,
          ...(extras
            ? [
                FunctionTypeT1.CONNECTION_MODE_SOUND_QUALITY_CONNECTION_QUALITY,
                FunctionTypeT1.UPSCALING_AUTO_OFF,
                FunctionTypeT1.SMART_TALKING_MODE_TYPE2,
                FunctionTypeT1.PLAYBACK_CONTROL_BY_WEARING_REMOVING_HEADPHONE_ON_OFF,
                FunctionTypeT1.POWER_OFF,
                FunctionTypeT1.HEAD_GESTURE_ON_OFF_TRAINING,
                FunctionTypeT1.AUTO_POWER_OFF_WITH_WEARING_DETECTION,
                // As a WH-1000XM6 does: the error-code BGM variant, not the plain one.
                FunctionTypeT1.BGM_MODE_SMALL_MIDDLE_LARGE_AND_ERRORCODE,
                FunctionTypeT1.UPMIX_CINEMA,
                FunctionTypeT1.CODEC_INDICATOR,
                FunctionTypeT1.PLAYBACK_CONTROLLER_WITH_CALL_VOLUME_ADJUSTMENT,
              ]
            : []),
          ...(quickOnly && !extras ? [
            FunctionTypeT1.SMART_TALKING_MODE_TYPE2,
            FunctionTypeT1.PLAYBACK_CONTROL_BY_WEARING_REMOVING_HEADPHONE_ON_OFF,
            FunctionTypeT1.AUTO_POWER_OFF_WITH_WEARING_DETECTION,
          ] : []),
          ...(upmixSeries ? [FunctionTypeT1.UPMIX_SERIES] : []),
        ];
        replies.push(
          mdr([
            CommandT1.CONNECT_RET_SUPPORT_FUNCTION,
            ConnectInquiredType.FIXED_VALUE,
            functions.length,
            // Each entry is a (functionType, priority) pair.
            ...functions.flatMap((fn) => [fn, 0]),
          ])
        );
        break;
      }

      case CommandT1.AUDIO_GET_PARAM: {
        const type = payload[1]!;
        if (type === AudioInquiredType.BGM_MODE_AND_ERRORCODE || type === AudioInquiredType.BGM_MODE) {
          replies.push(
            mdr([
              CommandT1.AUDIO_RET_PARAM,
              type,
              state.bgmEnabled ? EnableDisable.ENABLE : EnableDisable.DISABLE,
              state.bgmRoom,
            ])
          );
          break;
        }
        if (type === AudioInquiredType.UPMIX_SERIES) {
          replies.push(mdr([CommandT1.AUDIO_RET_PARAM, type, state.upmixSeries]));
          break;
        }
        if (type === AudioInquiredType.UPMIX_CINEMA) {
          replies.push(
            mdr([
              CommandT1.AUDIO_RET_PARAM,
              type,
              state.upmixCinema ? EnableDisable.ENABLE : EnableDisable.DISABLE,
            ])
          );
          break;
        }
        replies.push(
          mdr([
            CommandT1.AUDIO_RET_PARAM,
            type,
            type === AudioInquiredType.CONNECTION_MODE ? state.connectionMode : state.upscaling,
          ])
        );
        break;
      }
      case CommandT1.AUDIO_SET_PARAM: {
        const type = payload[1]!;
        if (type === AudioInquiredType.BGM_MODE_AND_ERRORCODE || type === AudioInquiredType.BGM_MODE) {
          state.bgmEnabled = payload[2] === EnableDisable.ENABLE;
          state.bgmRoom = payload[3]!;
        } else if (type === AudioInquiredType.UPMIX_SERIES) {
          state.upmixSeries = payload[2]!;
        } else if (type === AudioInquiredType.UPMIX_CINEMA) {
          state.upmixCinema = payload[2] === EnableDisable.ENABLE;
        } else if (type === AudioInquiredType.CONNECTION_MODE) {
          state.connectionMode = payload[2]!;
        } else {
          state.upscaling = payload[2]!;
        }
        break; // ACK only
      }

      case CommandT1.COMMON_GET_STATUS:
        replies.push(mdr([CommandT1.COMMON_RET_STATUS, CommonInquiredType.AUDIO_CODEC, state.codec]));
        break;

      case CommandT1.PLAY_GET_STATUS:
        replies.push(
          mdr([
            CommandT1.PLAY_RET_STATUS,
            PlayInquiredType.PLAYBACK_CONTROL_WITH_CALL_VOLUME_ADJUSTMENT,
            EnableDisable.ENABLE,
            state.playing ? PlaybackStatus.PLAY : PlaybackStatus.PAUSE,
            0,
          ])
        );
        break;
      case CommandT1.PLAY_SET_STATUS: {
        const control = payload[3];
        if (control === PlaybackControl.PLAY) state.playing = true;
        if (control === PlaybackControl.PAUSE) state.playing = false;
        replies.push(
          mdr([
            CommandT1.PLAY_NTFY_STATUS,
            PlayInquiredType.PLAYBACK_CONTROL_WITH_CALL_VOLUME_ADJUSTMENT,
            EnableDisable.ENABLE,
            state.playing ? PlaybackStatus.PLAY : PlaybackStatus.PAUSE,
            0,
          ])
        );
        break;
      }
      case CommandT1.PLAY_GET_PARAM:
        replies.push(mdr([CommandT1.PLAY_RET_PARAM, PlayInquiredType.MUSIC_VOLUME, state.volume]));
        break;
      case CommandT1.PLAY_SET_PARAM:
        state.volume = payload[2]!;
        break; // ACK only

      case CommandT1.POWER_GET_PARAM:
        if (state.autoPowerOffSetAttempted && autoPowerOffBehavior === "malformed") {
          replies.push(mdr([CommandT1.POWER_RET_PARAM, PowerInquiredType.AUTO_POWER_OFF_WEARING_DETECTION, state.autoPowerOff]));
          break;
        }
        replies.push(
          mdr([
            CommandT1.POWER_RET_PARAM,
            PowerInquiredType.AUTO_POWER_OFF_WEARING_DETECTION,
            state.autoPowerOff,
            AutoPowerOff.AFTER_5_MIN,
          ])
        );
        break;
      case CommandT1.POWER_SET_PARAM:
        state.autoPowerOffSetAttempted = true;
        if (autoPowerOffBehavior !== "reject") state.autoPowerOff = payload[2]!;
        break; // ACK only

      case CommandT1.SYSTEM_GET_PARAM:
        if (payload[1] === SystemInquiredType.PLAYBACK_CONTROL_BY_WEARING) {
          replies.push(
            mdr([
              CommandT1.SYSTEM_RET_PARAM,
              SystemInquiredType.PLAYBACK_CONTROL_BY_WEARING,
              state.pauseOnRemoval ? EnableDisable.ENABLE : EnableDisable.DISABLE,
            ])
          );
          break;
        }
        if (payload[1] === SystemInquiredType.HEAD_GESTURE_ON_OFF) {
          replies.push(
            mdr([
              CommandT1.SYSTEM_RET_PARAM,
              SystemInquiredType.HEAD_GESTURE_ON_OFF,
              state.headGesture ? EnableDisable.ENABLE : EnableDisable.DISABLE,
            ])
          );
          break;
        }
        replies.push(
          mdr([
            CommandT1.SYSTEM_RET_PARAM,
            SystemInquiredType.SMART_TALKING_MODE_TYPE2,
            // Inverted on the wire: ENABLE is 0.
            state.stcEnabled ? EnableDisable.ENABLE : EnableDisable.DISABLE,
            EnableDisable.DISABLE,
          ])
        );
        break;
      case CommandT1.SYSTEM_SET_PARAM:
        if (payload[1] === SystemInquiredType.PLAYBACK_CONTROL_BY_WEARING) {
          state.pauseOnRemoval = payload[2] === EnableDisable.ENABLE;
        } else if (payload[1] === SystemInquiredType.HEAD_GESTURE_ON_OFF) {
          state.headGesture = payload[2] === EnableDisable.ENABLE;
        } else {
          state.stcEnabled = payload[2] === EnableDisable.ENABLE;
        }
        break; // ACK only

      case CommandT1.POWER_SET_STATUS:
        if (payload[1] === PowerInquiredType.POWER_OFF) state.poweredOff = true;
        break; // ACK only
      case CommandT1.SYSTEM_GET_EXT_PARAM:
        replies.push(
          mdr([
            CommandT1.SYSTEM_RET_EXT_PARAM,
            SystemInquiredType.SMART_TALKING_MODE_TYPE2,
            state.stcSensitivity,
            state.stcTimeout,
          ])
        );
        break;
      case CommandT1.SYSTEM_SET_EXT_PARAM:
        state.stcSensitivity = payload[2]!;
        state.stcTimeout = payload[3]!;
        break; // ACK only
      case CommandT1.POWER_GET_STATUS:
        replies.push(mdr([CommandT1.POWER_RET_STATUS, PowerInquiredType.BATTERY, 78, BatteryChargingStatus.NOT_CHARGING]));
        break;

      case CommandT1.NCASM_SET_PARAM:
        state.ncAsm = {
          onOff: payload[3]!,
          mode: payload[4]!,
          ambientMode: payload[5]!,
          level: payload[6]!,
          // Only present on the noise-adaptation shape.
          autoOn: payload[7] ?? state.ncAsm.autoOn,
          sensitivity: payload[8] ?? state.ncAsm.sensitivity,
        };
        replies.push(mdr(ncAsmFrame(CommandT1.NCASM_NTFY_PARAM)));
        break;
      case CommandT1.NCASM_GET_PARAM:
        replies.push(mdr(ncAsmFrame(CommandT1.NCASM_RET_PARAM)));
        break;

      case CommandT1.EQEBB_SET_PARAM: {
        state.eqPreset = payload[2]!;
        const count = payload[3]!;
        if (count > 0) state.eqSteps = Array.from(payload.subarray(4, 4 + count));
        break; // ACK only — the client re-GETs, per Headphones.cpp:307-308
      }
      case CommandT1.EQEBB_GET_PARAM:
        replies.push(
          mdr([
            CommandT1.EQEBB_RET_PARAM,
            EqEbbInquiredType.PRESET_EQ,
            state.eqPreset,
            state.eqSteps.length,
            ...state.eqSteps,
          ])
        );
        break;
    }
    return replies;
  };
}
