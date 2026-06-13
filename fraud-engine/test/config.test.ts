import { describe, it, expect } from "vitest";
import { productionFatals } from "../src/config";

const base = {
  NODE_ENV: "production",
  PORT: 4500,
  ARGUS_BASE_URL: "https://argus.example.com",
  ARGUS_SERVICE_KEY: "x".repeat(40),
  SQLITE_PATH: "./data/fraud.db",
  FRAUD_AUTO_REMEDIATE: true,
};

describe("productionFatals", () => {
  it("rejects the known dev API key in production", () => {
    const fatals = productionFatals({ ...base, FRAUD_ENGINE_API_KEY: "fraud_dev_key_change_in_production" });
    expect(fatals.length).toBeGreaterThan(0);
  });

  it("rejects a short API key", () => {
    const fatals = productionFatals({ ...base, FRAUD_ENGINE_API_KEY: "short" });
    expect(fatals.join(" ")).toMatch(/32 characters/);
  });

  it("passes with a strong distinct key", () => {
    expect(productionFatals({ ...base, FRAUD_ENGINE_API_KEY: "k".repeat(40) })).toEqual([]);
  });
});
