import { describe, expect, it } from "vitest";
import { hashForPage, pageFromHash } from "./pageRouting";

describe("page routing", () => {
  it.each([
    ["", "home"],
    ["#/", "home"],
    ["#/library", "library"],
    ["#add", "add"],
    ["#/settings/", "settings"],
  ] as const)("reads %s as %s", (hash, page) => {
    expect(pageFromHash(hash)).toBe(page);
  });

  it("falls back to home for unknown routes", () => {
    expect(pageFromHash("#/something-else")).toBe("home");
  });

  it.each([
    ["home", "#/"],
    ["library", "#/library"],
    ["add", "#/add"],
    ["settings", "#/settings"],
  ] as const)("creates the route for %s", (page, hash) => {
    expect(hashForPage(page)).toBe(hash);
  });
});
