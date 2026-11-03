import { describe, it, expect } from "vitest";
import { detectPlatform, isInLine, portalUrl, externalPortalUrl } from "./location-help";
import {
  UA_IPHONE_LINE,
  UA_ANDROID_LINE,
  UA_IPHONE_SAFARI,
  UA_ANDROID_CHROME,
  UA_DESKTOP_CHROME,
} from "./__fixtures__/user-agents";

describe("detectPlatform / isInLine", () => {
  const cases: Array<[string, string, "ios" | "android" | "other", boolean]> = [
    ["iPhone LINE", UA_IPHONE_LINE, "ios", true],
    ["Android LINE", UA_ANDROID_LINE, "android", true],
    ["iPhone Safari", UA_IPHONE_SAFARI, "ios", false],
    ["Android Chrome", UA_ANDROID_CHROME, "android", false],
    ["桌機 Chrome", UA_DESKTOP_CHROME, "other", false],
  ];

  it.each(cases)("%s", (_name, ua, platform, inLine) => {
    expect(detectPlatform(ua)).toBe(platform);
    expect(isInLine(ua)).toBe(inLine);
  });

  it("iPad 與 iPod 也算 ios", () => {
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)")).toBe("ios");
  });

  it("空字串視為 other、不在 LINE", () => {
    expect(detectPlatform("")).toBe("other");
    expect(isInLine("")).toBe(false);
  });
});

describe("portal 網址", () => {
  it("portalUrl 回 /portal", () => {
    expect(portalUrl("https://app.example.com")).toBe("https://app.example.com/portal");
  });

  it("externalPortalUrl 帶 openExternalBrowser=1", () => {
    expect(externalPortalUrl("https://app.example.com")).toBe(
      "https://app.example.com/portal?openExternalBrowser=1",
    );
  });
});
