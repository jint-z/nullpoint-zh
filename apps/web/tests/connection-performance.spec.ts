import { test, expect } from "@playwright/test";
import { CommandT1, CommandT2, DataType } from "@ssc/core";

test("measure dashboard availability with delayed optional reads", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=known&delayExtras=250");
  const connect = page.getByRole("button", { name: "连接耳机" });
  await expect(connect).toBeEnabled();
  const start = Date.now();
  await connect.click();
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 15000 });
  const elapsed = Date.now() - start;
  console.log(`dashboard_after_ms=${elapsed}`);
  expect(elapsed).toBeLessThan(2000);
  await expect(page.getByRole("button", { name: "降噪", exact: true })).toBeEnabled();
  await expect(page.getByText("正在读取其他设置…")).toBeVisible();
  await expect(page.getByRole("group", { name: "聆听模式" })).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("正在读取其他设置…")).toBeVisible();
  await expect(page.getByText("正在读取其他设置…")).toBeHidden({ timeout: 10000 });
});

test("does not infer a standard mode from an unanswered listening setting", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=known&skipCinemaRead=true");
  const connect = page.getByRole("button", { name: "连接耳机" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 1500 });
  await expect(page.getByText("无法读取完整的聆听设置，请重新连接后重试。")).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole("group", { name: "聆听模式" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "降噪", exact: true })).toBeEnabled();
});

test("dashboard appears before a slow optional read and a mode change gets the next turn", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=known&holdFirstExtra=true");
  const connect = page.getByRole("button", { name: "连接耳机" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.firstExtraHeld())).toBe(true);
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 1500 });
  await expect(page.getByText("正在读取其他设置…")).toBeVisible();
  await expect(page.getByRole("group", { name: "聆听模式" })).toHaveCount(0);
  await page.getByRole("button", { name: "环境音", exact: true }).click();
  await page.evaluate(() => (window as any).__mock.releaseFirstExtra());
  await expect.poll(() => page.evaluate(() => (window as any).__mock.commandWrites() as number[]))
    .toContain(CommandT1.NCASM_SET_PARAM);
  await expect(page.getByText("正在读取其他设置…")).toBeHidden({ timeout: 10000 });
  const commands = await page.evaluate(() => (window as any).__mock.commandWrites() as number[]);
  const firstExtra = commands.indexOf(CommandT1.AUDIO_GET_PARAM);
  const secondExtra = commands.indexOf(CommandT1.AUDIO_GET_PARAM, firstExtra + 1);
  expect(firstExtra).toBeGreaterThanOrEqual(0);
  expect(secondExtra).toBeGreaterThan(firstExtra);
  expect(commands.indexOf(CommandT1.NCASM_SET_PARAM)).toBeLessThan(secondExtra);
  await expect(page.getByRole("button", { name: "环境音", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "聆听模式" })).toBeVisible();
});

test("paired-device retries yield to a noise-control command", async ({ page }) => {
  await page.goto("/test-fixtures/?scenario=known&table2=true&holdPairRead=true");
  const connect = page.getByRole("button", { name: "连接耳机" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.locator(".device-panel h1")).toHaveText("WH-1000XM6", { timeout: 1500 });
  await expect.poll(() => page.evaluate(() => (window as any).__mock.pairReadHeld())).toBe(true);
  await page.getByRole("button", { name: "环境音", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.wireWrites() as Array<{ type: number; command: number }>),
    { timeout: 6000 }).toContainEqual({ type: DataType.DATA_MDR, command: CommandT1.NCASM_SET_PARAM });
  await expect.poll(() => page.evaluate(({ type, command }) =>
    ((window as any).__mock.wireWrites() as Array<{ type: number; command: number }>).filter((entry) => entry.type === type && entry.command === command).length,
    { type: DataType.DATA_MDR_NO2, command: CommandT2.PERI_GET_PARAM })).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("正在读取其他设置…")).toBeHidden();
  const wire = await page.evaluate(() => (window as any).__mock.wireWrites() as Array<{ type: number; command: number }>);
  const pair = (entry: { type: number; command: number }) => entry.type === DataType.DATA_MDR_NO2 && entry.command === CommandT2.PERI_GET_PARAM;
  const firstPair = wire.findIndex(pair);
  const secondPair = wire.findIndex((entry, index) => index > firstPair && pair(entry));
  expect(firstPair).toBeGreaterThanOrEqual(0);
  expect(secondPair).toBeGreaterThan(firstPair);
  expect(wire.findIndex((entry) => entry.type === DataType.DATA_MDR && entry.command === CommandT1.NCASM_SET_PARAM)).toBeLessThan(secondPair);
});
