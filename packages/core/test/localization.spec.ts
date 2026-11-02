import { writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import React from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { describe, it, expect } from "vitest";
import { setCurrentLanguage, tr } from "../../../apps/web/src/i18n.js";
import { ConnectIdle } from "../../../apps/web/src/screens/ConnectIdle.js";
import { ConnectFailed } from "../../../apps/web/src/screens/ConnectFailed.js";
import { Dashboard } from "../../../apps/web/src/screens/Dashboard.js";
import { Settings } from "../../../apps/web/src/screens/Settings.js";
import { SoundSettings } from "../../../apps/web/src/components/SoundSettings.js";
import { DEFAULT_SETTINGS } from "../../../apps/web/src/state/useSettings.js";
import { Headphones } from "../src/headphones.js";
import { LoopbackTransport } from "../src/transport.js";
import { AutoPowerOff } from "../src/constants.js";

(globalThis as any).__APP_VERSION__ = "1.2.0";
const noop = () => {};
function saveSnapshot(name: string, content: string) {
  const dist = resolve(process.cwd(), "../../apps/web/dist");
  const css = readdirSync(resolve(dist, "assets")).find((name) => name.endsWith(".css"));
  writeFileSync(resolve(dist, `mock-${name}.html`), `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"><link rel="stylesheet" href="/assets/${css}"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root">${content}</div></body></html>`);
}
describe("localised UI with synthetic state", () => {
  it("renders the disconnected screen in Chinese and English", () => {
    setCurrentLanguage("zh-CN");
    let view = renderToStaticMarkup(React.createElement(ConnectIdle, {onConnect: noop, onSettingsClick: noop, preparing: false}));
    expect(view).not.toContain("未连接耳机");
    expect(view).toContain("连接耳机");
    saveSnapshot("idle", view);
    setCurrentLanguage("en");
    view = renderToStaticMarkup(React.createElement(ConnectIdle, {onConnect: noop, onSettingsClick: noop, preparing: false}));
    expect(view).not.toContain("No headphones connected");
    expect(view).toContain("Connect headphones");
    setCurrentLanguage("zh-CN");
  });
  it("translates connection failures without changing their categorisation", () => {
    const view = renderToStaticMarkup(React.createElement(ConnectFailed, {message:"failed to open",onRetry:noop,onChooseAnother:noop,onSettingsClick:noop}));
    expect(view).toContain("其他程序占用了控制通道");
    expect(view).toContain("重试");
    saveSnapshot("failed", view);
  });
  it("renders settings and synthetic XM6 controls without touching Bluetooth", () => {
    const hp = new Headphones(new LoopbackTransport());
    const state:any = {...hp.state, modelName:"WH-1000XM6", firmwareVersion:"3.1.5", battery:{level:84,charging:0},
      ncAsm:{onOff:1,mode:1,ambientMode:0,ambientLevel:12,autoAmbient:null},
      eq:{preset:0xa0,bands:{layout:"graphic10",values:Array(10).fill(0)}},
      pairedDevices:[{name:"Off",kind:"other",address:"AA:BB:CC:DD:EE:FF",connected:true,hasPlaybackRight:true}],
      speakToChat:{enabled:false,sensitivity:0,timeout:1}, upscaling:0,pauseOnRemoval:true,headGesture:false,autoPowerOff:0};
    const view = renderToStaticMarkup(React.createElement(Dashboard,{state,headphones:hp,onSettingsClick:noop,reconnecting:false,onCancelReconnect:noop}));
    for (const expected of ["降噪控制","均衡器","环境音", "智能免摘对话", "摘下时暂停", "Off"]) expect(view).toContain(expected);
    saveSnapshot("dashboard", view);
    const settingsView = renderToStaticMarkup(React.createElement(Settings,{settings:DEFAULT_SETTINGS,update:noop,isDesktop:true,deviceState:state,headphones:null,onDone:noop}));
    for(const expected of ["设置","自动重连","主题","协议检查器"]) expect(settingsView).toContain(expected);
    saveSnapshot("settings", settingsView);
  });
  it("retains unknown product names and protocol literals", () => {
    expect(tr("WH-1000XM6")).toBe("WH-1000XM6");
    expect(tr("AAC")).toBe("AAC");
  });
  it("shows only the two reported XM6 modes and preserves other model options", () => {
    const props = {
      modelName: "WH-1000XM6", connectionMode: null, upscaling: null, speakToChat: null,
      pauseOnRemoval: null, headGesture: null, autoPowerOff: AutoPowerOff.WHEN_REMOVED,
      autoPowerOffWrite: "idle" as const,
      onConnectionModeChange: noop, onUpscalingChange: noop, onSpeakToChatChange: noop,
      onPauseOnRemovalChange: noop, onHeadGestureChange: noop, onAutoPowerOffChange: noop,
    };
    const xm6 = renderToStaticMarkup(React.createElement(SoundSettings, props));
    expect(xm6).toContain("摘下后关机");
    expect(xm6).toContain("不自动关机");
    expect(xm6).toContain("开启后，摘下耳机约 15 分钟后关机");
    expect(xm6).not.toContain(">5 分钟<");
    expect(xm6).not.toContain(">30 分钟<");
    const disabled = renderToStaticMarkup(React.createElement(SoundSettings, { ...props, autoPowerOff: AutoPowerOff.DISABLED }));
    expect(disabled).toContain('aria-checked="true"');
    expect(disabled).toContain("不自动关机");
    const unknown = renderToStaticMarkup(React.createElement(SoundSettings, { ...props, autoPowerOff: 0x7f }));
    expect(unknown).toContain("耳机返回了其他自动关机状态");
    expect(unknown).toContain("0x7f");
    expect(unknown).not.toContain('aria-checked="true"');
    const rejected = renderToStaticMarkup(React.createElement(SoundSettings, { ...props, autoPowerOffWrite: "rejected" }));
    expect(rejected).toContain("耳机没有接受所选设置");
    const other = renderToStaticMarkup(React.createElement(SoundSettings, { ...props, modelName: "WH-1000XM5" }));
    expect(other).toContain("5 分钟");
    expect(other).toContain("30 分钟");
  });
});
