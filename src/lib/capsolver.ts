// Minimal CapSolver client for image-text captchas (datalex ModCaptcha: a 5-char text GIF served by
// file.php?show_captcha=1). SERVER-SIDE ONLY — the API key is a secret read from
// process.env.CAPSOLVER_API_KEY, never bundled into the frontend or committed. The transport is
// injectable (opts.http) so this is unit-tested deterministically without a key or the network.
//
// CapSolver REST: POST /createTask {clientKey, task:{type:"ImageToTextTask", body:<base64>}}.
// Image tasks usually resolve in the createTask response (status "ready"); otherwise poll
// /getTaskResult {clientKey, taskId} until status !== "processing".
import { request } from "node:https";

const API_HOST = "api.capsolver.com";

export type CapHttp = (path: string, payload: unknown) => Promise<Record<string, unknown>>;

// Default transport: HTTPS POST JSON to api.capsolver.com.
const httpsJson: CapHttp = (path, payload) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const req = request(
      { host: API_HOST, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as Record<string, unknown>);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("capsolver timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

export interface CapSolverOpts {
  apiKey?: string; // defaults to process.env.CAPSOLVER_API_KEY
  http?: CapHttp; // injectable transport (tests)
  pollMs?: number;
  maxPolls?: number;
  delay?: (ms: number) => Promise<void>; // injectable so tests don't actually wait
}

function readSolutionText(r: Record<string, unknown>): string | null {
  const sol = r.solution as { text?: string } | undefined;
  return typeof sol?.text === "string" ? sol.text : null;
}

// Solve a base64 image captcha → the recognized text. Throws on a missing key or a CapSolver error.
export async function solveImageToText(imageBase64: string, opts: CapSolverOpts = {}): Promise<string> {
  const key = opts.apiKey ?? process.env.CAPSOLVER_API_KEY;
  if (!key) throw new Error("CAPSOLVER_API_KEY not set");
  const http = opts.http ?? httpsJson;
  const delay = opts.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const created = await http("/createTask", { clientKey: key, task: { type: "ImageToTextTask", module: "common", body: imageBase64 } });
  if (created.errorId) throw new Error(`capsolver createTask: ${created.errorCode || created.errorDescription}`);
  // Image tasks frequently come back resolved already.
  if (created.status === "ready") {
    const text = readSolutionText(created);
    if (text != null) return text;
  }
  const taskId = created.taskId;
  if (typeof taskId !== "string") throw new Error("capsolver: no taskId returned");

  const maxPolls = opts.maxPolls ?? 20;
  for (let i = 0; i < maxPolls; i++) {
    await delay(opts.pollMs ?? 1000);
    const r = await http("/getTaskResult", { clientKey: key, taskId });
    if (r.errorId) throw new Error(`capsolver getTaskResult: ${r.errorCode || r.errorDescription}`);
    if (r.status === "ready") {
      const text = readSolutionText(r);
      if (text != null) return text;
      throw new Error("capsolver: ready but no solution text");
    }
  }
  throw new Error("capsolver: timed out waiting for solution");
}
