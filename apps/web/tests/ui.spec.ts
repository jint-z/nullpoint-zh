import { test, expect, type Page } from "@playwright/test";
import { AudioInquiredType, CommandT1, EnableDisable, RoomSize } from "@ssc/core";

async function connect(page: Page, query = "scenario=known") {
  await page.goto("/test-fixtures/?" + query);
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeEnabled();
  await page.getByRole("button", { name: "连接耳机" }).click();
  await expect(page.locator(".device-panel h1")).toBeVisible({ timeout: 15000 });
}

test("single button tries granted ports and preserves XM6 controls", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=known-mixed");
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeEnabled();
  await expect(page.locator("main button")).toHaveCount(1);
  await page.getByRole("button", { name: "连接耳机" }).click();
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 15000 });
  await expect(page.locator(".device-image img")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mock.portCount())).toBe(0);
  await page.getByText("更多功能", { exact: true }).click();
  const power = page.getByRole("radiogroup", { name: "自动关机" });
  await expect(power.getByRole("radio")).toHaveCount(2);
  await power.getByRole("radio", { name: "摘下后关机" }).click();
  await expect(power.getByRole("radio", { name: "摘下后关机" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "环境音", exact: true }).click();
  await expect(page.getByRole("button", { name: "环境音", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("均衡器曲线")).toBeVisible();
  await expect(page.getByRole("switch", { name: "DSEE Extreme" })).toHaveCount(1);
});

test("failure offers retry and a live, cancellable picker", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=failed");
  await page.getByRole("button", { name: "连接耳机" }).click();
  await expect(page.getByText("failed to open: simulated port unavailable")).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("failed to open: simulated port unavailable")).toBeVisible();
  await page.getByRole("button", { name: "选择其他设备" }).click();
  await expect(page.getByRole("dialog", { name: "选择设备" })).toBeVisible();
  await page.evaluate(() => (window as any).__mock.setOffered([{ id: "a", name: "" }, { id: "b", name: "" }]));
  await expect(page.getByRole("button", { name: /未知设备/ })).toHaveCount(2);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeVisible();
});

test("first connection uses the picker and supports cancellation", async ({ page }) => {
  await page.goto("/test-fixtures/");
  await page.getByRole("button", { name: "连接耳机" }).click();
  await expect(page.getByRole("dialog", { name: "选择设备" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeVisible();
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeEnabled();
  await page.getByRole("button", { name: "连接耳机" }).click();
  await page.getByRole("button", { name: /System headset/ }).click();
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 15000 });
});

test("late connection after cancellation is retired", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=late");
  await page.getByRole("button", { name: "连接耳机" }).click();
  await expect(page.getByText("正在连接…")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await page.evaluate(() => (window as any).__mock.releaseOpen());
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeVisible();
  // Verify that open actually completed after cancellation, and that the resulting port closed.
  await expect.poll(() => page.evaluate(() => (window as any).__mock.opens()), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__mock.closes()), { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__mock.isOpen())).toBe(false);
  await expect(page.locator(".device-panel")).toHaveCount(0);
});

test("capabilities and art follow the reported model and state", async ({ page }) => {
  await connect(page, "scenario=known&model=WF-1000XM5&extras=false");
  await expect(page.locator(".device-panel h1")).toHaveText("WF-1000XM5");
  await expect(page.locator(".device-image img")).toHaveCount(0);
  await expect(page.locator(".device-image svg")).toBeVisible();
  await expect(page.getByText("快捷设置")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "聆听模式" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "DSEE Extreme" })).toHaveCount(0);
});

test("XM6 power writes expose pending and rejected states", async ({ page }) => {
  await connect(page, "scenario=known&power=reject");
  await page.getByText("更多功能", { exact: true }).click();
  const power = page.getByRole("radiogroup", { name: "自动关机" });
  await power.getByRole("radio", { name: "摘下后关机" }).click();
  await expect(page.getByText("正在确认耳机设置…")).toBeVisible();
  await expect(page.getByText("耳机没有接受所选设置")).toBeVisible({ timeout: 10000 });
  await expect(power.getByRole("radio", { name: "摘下后关机" })).toHaveAttribute("aria-checked", "false");
});

test("listening modes switch in order and quick settings live under more features", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await connect(page);
  const panel = page.locator(".listening-panel");
  const modes = panel.getByRole("group", { name: "聆听模式" });
  const background = modes.getByRole("button", { name: "背景音乐" });
  const cinema = modes.getByRole("button", { name: "影院混音" });
  const off = modes.getByRole("button", { name: "标准" });
  await expect(modes).toBeVisible();
  await expect(off).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("快捷设置")).toHaveCount(0);
  await expect(page.locator(".more-controls")).not.toHaveAttribute("open");
  await expect(page.getByRole("switch", { name: "摘下时暂停" })).toBeHidden();

  await background.click();
  await expect(background).toHaveAttribute("aria-pressed", "true");
  const room = panel.getByRole("radiogroup", { name: "房间大小" });
  await expect(room.getByRole("radio", { name: "中", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(background).toBeEnabled();
  await room.getByRole("radio", { name: "大", exact: true }).click();
  await expect(room.getByRole("radio", { name: "大", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(cinema).toBeEnabled();
  await page.screenshot({ path: "test-results/listening-mode-light.png" });
  await cinema.click();
  await expect(cinema).toHaveAttribute("aria-pressed", "true");
  await expect(background).toHaveAttribute("aria-pressed", "false");
  await expect(room).toHaveCount(0);
  await expect(off).toBeEnabled();
  await off.click();
  await expect(off).toHaveAttribute("aria-pressed", "true");
  await expect(background).toBeEnabled();
  await background.click();
  await expect(room.getByRole("radio", { name: "大", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(background).toBeEnabled();

  const writes = await page.evaluate(() => (window as any).__mock.audioWrites() as number[][]);
  expect(writes).toEqual([
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.BGM_MODE_AND_ERRORCODE, EnableDisable.ENABLE, RoomSize.MIDDLE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.BGM_MODE_AND_ERRORCODE, EnableDisable.ENABLE, RoomSize.LARGE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.UPMIX_CINEMA, EnableDisable.ENABLE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.BGM_MODE_AND_ERRORCODE, EnableDisable.DISABLE, RoomSize.LARGE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.UPMIX_CINEMA, EnableDisable.DISABLE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.BGM_MODE_AND_ERRORCODE, EnableDisable.ENABLE, RoomSize.LARGE],
  ]);
  await page.getByText("更多功能", { exact: true }).click();
  const more = page.locator(".more-controls");
  await expect(more.getByRole("switch", { name: "摘下时暂停" })).toBeVisible();
  await expect(more.getByRole("radiogroup", { name: "自动关机" })).toBeVisible();
  await expect(more.getByRole("switch", { name: "智能免摘对话" })).toBeVisible();
  await expect(more.getByRole("button", { name: "背景音乐" })).toHaveCount(0);
});

test("a refused listening change shows the device's actual mode", async ({ page }) => {
  await connect(page, "scenario=known&reject=cinema-enable");
  const modes = page.getByRole("group", { name: "聆听模式" });
  const background = modes.getByRole("button", { name: "背景音乐" });
  const cinema = modes.getByRole("button", { name: "影院混音" });
  const standard = modes.getByRole("button", { name: "标准" });
  await cinema.click();
  await expect(page.getByRole("alert")).toHaveText("耳机未接受所选聆听设置。", { timeout: 15000 });
  await expect(background).toHaveAttribute("aria-pressed", "false");
  await expect(cinema).toHaveAttribute("aria-pressed", "false");
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  const writes = await page.evaluate(() => (window as any).__mock.audioWrites() as number[][]);
  expect(writes).toEqual([[CommandT1.AUDIO_SET_PARAM, AudioInquiredType.UPMIX_CINEMA, EnableDisable.ENABLE]]);
});

test("an unanswered listening readback is reported as unconfirmed", async ({ page }) => {
  await connect(page, "scenario=known&skipReadAfterWrite=true");
  const modes = page.getByRole("group", { name: "聆听模式" });
  await modes.getByRole("button", { name: "背景音乐" }).click();
  await expect(page.getByRole("alert")).toHaveText("无法确认聆听设置，请重试。", { timeout: 10000 });
  await expect(modes.getByRole("button", { name: "背景音乐" })).toBeEnabled();
});

test("standard clears both effects if the headphones report both enabled", async ({ page }) => {
  await connect(page, "scenario=known&initialModes=both");
  const modes = page.getByRole("group", { name: "聆听模式" });
  const background = modes.getByRole("button", { name: "背景音乐" });
  const cinema = modes.getByRole("button", { name: "影院混音" });
  const standard = modes.getByRole("button", { name: "标准" });
  await expect(background).toHaveAttribute("aria-pressed", "true");
  await expect(cinema).toHaveAttribute("aria-pressed", "true");
  await expect(standard).toHaveAttribute("aria-pressed", "false");
  await standard.click();
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await expect(standard).toBeEnabled();
  await expect(background).toHaveAttribute("aria-pressed", "false");
  await expect(cinema).toHaveAttribute("aria-pressed", "false");
  const writes = await page.evaluate(() => (window as any).__mock.audioWrites() as number[][]);
  expect(writes).toEqual([
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.BGM_MODE_AND_ERRORCODE, EnableDisable.DISABLE, RoomSize.MIDDLE],
    [CommandT1.AUDIO_SET_PARAM, AudioInquiredType.UPMIX_CINEMA, EnableDisable.DISABLE],
  ]);
});

test("additional spatial upmix and quick-only capabilities remain available", async ({ page }) => {
  await connect(page, "scenario=known&upmixSeries=true");
  const spatial = page.getByRole("radiogroup", { name: "空间混音" });
  await expect(spatial).toBeVisible();
  await spatial.getByRole("radio", { name: "音乐" }).click();
  await expect(spatial.getByRole("radio", { name: "音乐" })).toHaveAttribute("aria-checked", "true");

  await connect(page, "scenario=known&extras=false&quickOnly=true");
  await expect(page.getByRole("group", { name: "聆听模式" })).toHaveCount(0);
  await page.getByText("更多功能", { exact: true }).click();
  await expect(page.getByRole("switch", { name: "摘下时暂停" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "自动关机" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "智能免摘对话" })).toBeVisible();
});

test("device disconnect shows reconnecting and cancellation returns to idle", async ({ page }) => {
  await connect(page);
  await page.evaluate(() => (window as any).__mock.disconnect());
  await expect(page.getByText("连接已中断，正在重新连接…")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "连接耳机" })).toBeVisible();
});

test("settings persist, support both languages and responsive layouts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await connect(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("radio", { name: "浅色" }).click();
  await page.getByLabel("语言").selectOption("en");
  await expect(page.getByText("Language", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByRole("radio", { name: "light" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Connect headphones" }).click();
  await expect(page.locator(".device-panel h1")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("group", { name: "Listening mode" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Listening mode" }).getByRole("button", { name: "Standard" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Noise control mode" }).getByRole("button", { name: "Off" })).toBeVisible();
  for (const viewport of [{width:720,height:560}, {width:900,height:640}, {width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Ambient Sound" })).toBeInViewport();
    await page.screenshot({ path: "test-results/dashboard-" + viewport.width + ".png" });
  }
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test("Chinese dark dashboard stays within the viewport at each window size", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("test.settings", JSON.stringify({ language: "zh-CN", theme: "dark" })));
  await connect(page);
  await page.getByText("更多功能", { exact: true }).click();
  for (const viewport of [{width:720,height:560}, {width:900,height:640}, {width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const controls = [...document.querySelectorAll(".dashboard-controls button, .dashboard-controls [role=slider], .dashboard-controls [role=switch]")];
      return controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width === 0 || (rect.left >= -1 && rect.right <= innerWidth + 1);
      });
    })).toBe(true);
    await page.locator(".dashboard-scroll").evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ path: "test-results/dashboard-dark-" + viewport.width + ".png" });
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
