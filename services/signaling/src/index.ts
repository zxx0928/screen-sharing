import { startSignalingServer } from "./server.js";

const port = readPort(process.env.SIGNALING_PORT ?? "8787");
const host = process.env.SIGNALING_HOST ?? "127.0.0.1";

const handle = await startSignalingServer(port, host);
console.log(`[signaling] listening on ws://${host}:${handle.port}`);
console.log("[signaling] rooms are in-memory and 1:1 (one host, one controller)");

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[signaling] ${signal}, closing`);
  void handle.close().finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function readPort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    console.error(`[signaling] invalid SIGNALING_PORT: ${raw}`);
    process.exit(1);
  }
  return value;
}
