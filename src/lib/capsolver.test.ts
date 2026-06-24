import { describe, it, expect } from "vitest";
import { solveImageToText } from "./capsolver";
import type { CapHttp } from "./capsolver";

const noDelay = () => Promise.resolve();

describe("solveImageToText", () => {
  it("returns the text when createTask resolves synchronously", async () => {
    const http: CapHttp = async (path) => {
      expect(path).toBe("/createTask");
      return { errorId: 0, status: "ready", solution: { text: "AB12C" } };
    };
    expect(await solveImageToText("<b64>", { apiKey: "k", http, delay: noDelay })).toBe("AB12C");
  });

  it("polls getTaskResult until ready", async () => {
    const seq = [
      { errorId: 0, taskId: "t1" }, // createTask → processing (no status)
      { errorId: 0, status: "processing" },
      { errorId: 0, status: "ready", solution: { text: "x9y8z" } },
    ];
    let i = 0;
    const http: CapHttp = async () => seq[i++];
    expect(await solveImageToText("<b64>", { apiKey: "k", http, delay: noDelay })).toBe("x9y8z");
  });

  it("throws on a CapSolver error response", async () => {
    const http: CapHttp = async () => ({ errorId: 1, errorCode: "ERROR_KEY_DENIED_ACCESS" });
    await expect(solveImageToText("<b64>", { apiKey: "k", http, delay: noDelay })).rejects.toThrow(/KEY_DENIED/);
  });

  it("throws when no API key is available", async () => {
    const prev = process.env.CAPSOLVER_API_KEY;
    delete process.env.CAPSOLVER_API_KEY;
    await expect(solveImageToText("<b64>", { http: async () => ({}), delay: noDelay })).rejects.toThrow(/CAPSOLVER_API_KEY/);
    if (prev !== undefined) process.env.CAPSOLVER_API_KEY = prev;
  });

  it("times out if never ready", async () => {
    const http: CapHttp = async (path) => (path === "/createTask" ? { errorId: 0, taskId: "t" } : { errorId: 0, status: "processing" });
    await expect(solveImageToText("<b64>", { apiKey: "k", http, delay: noDelay, maxPolls: 3 })).rejects.toThrow(/timed out/);
  });
});
