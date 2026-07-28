import { describe, expect, it } from "vitest";
import {
  clearGoogleAuthorization,
  loadGoogleAuthorization,
  storeGoogleAuthorization,
  type GoogleAuthorization,
} from "./googleSession";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const authorization: GoogleAuthorization = {
  accessToken: "short-lived-token",
  expiresAt: 4_000_000,
};

describe("Google session", () => {
  it("restores a valid authorization", () => {
    const storage = createStorage();
    storeGoogleAuthorization(storage, authorization);
    expect(loadGoogleAuthorization(storage, 1_000_000)).toEqual(authorization);
  });

  it("removes an authorization close to expiry", () => {
    const storage = createStorage();
    storeGoogleAuthorization(storage, authorization);
    expect(loadGoogleAuthorization(storage, 3_980_000)).toBeNull();
    expect(storage.getItem("stilla-google-token")).toBeNull();
  });

  it("clears the stored authorization", () => {
    const storage = createStorage();
    storeGoogleAuthorization(storage, authorization);
    clearGoogleAuthorization(storage);
    expect(loadGoogleAuthorization(storage)).toBeNull();
  });
});
