import { cloneElement, useEffect, useState, type ReactElement } from "react";
import translations from "./translations.json";

type Language = "zh-CN" | "en";
let current: Language = "zh-CN";
export function setCurrentLanguage(value: Language): void { current = value; }
const dictionary: Record<string, string> = translations;
export function tr<T>(value: T): T {
  if (current !== "zh-CN" || typeof value !== "string") return value;
  if (value.startsWith("DRAG OR ARROW KEYS · ")) return value.replace("DRAG OR ARROW KEYS · ", "拖动或使用方向键 · ") as T;
  if (value.startsWith("Link lost — reconnecting to ")) return value.replace("Link lost — reconnecting to ", "连接中断，正在重新连接 ") as T;
  if (value.startsWith("Playing ") && value.endsWith(" — ")) return value.replace(/^Playing (.*) — $/, "正在播放 $1 — ") as T;
  const illustration = value.match(/^(.+) illustration$/);
  if (illustration) return `${illustration[1]} 示意图` as T;
  const dynamic = value.match(/^(Apply|Delete) (.+)$/);
  if (dynamic) return `${dynamic[1] === "Apply" ? "应用" : "删除"} ${dynamic[2]}` as T;
  return (dictionary[value] ?? value) as T;
}
export function LocaleRoot({ children }: { children: ReactElement }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const settings = JSON.parse(localStorage.getItem("nullpoint.settings") ?? "{}");
      return (settings.language ?? localStorage.getItem("nullpoint.language")) === "en" ? "en" : "zh-CN";
    } catch { return "zh-CN"; }
  });
  setCurrentLanguage(language);
  useEffect(() => {
    const changed = (event: Event) => setLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener("nullpoint-language", changed);
    return () => window.removeEventListener("nullpoint-language", changed);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "zh-CN" ? "Nullpoint — 索尼耳机控制" : "Nullpoint — desktop and web control for Sony headphones";
    try { localStorage.setItem("nullpoint.language", language); } catch { /* storage unavailable */ }
  }, [language]);
  useEffect(() => {
    const bridge = window.nullpoint;
    if (!bridge) return;
    void bridge.getSettings().then((settings) => setLanguage(settings.language === "en" ? "en" : "zh-CN"));
    return bridge.onSettingsChanged((settings) => setLanguage(settings.language === "en" ? "en" : "zh-CN"));
  }, []);
  return cloneElement(children);
}
