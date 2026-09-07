import { resolve } from "node:path";

import { createPeerlyApp } from "./app.js";

const port = parsePort(process.env.PEERLY_SERVER_PORT);
const host = process.env.PEERLY_SERVER_HOST?.trim() || "127.0.0.1";
const dataDirectory =
  process.env.PEERLY_SERVER_DATA_DIR?.trim() ||
  resolve(import.meta.dirname, "../../../data/server");

const app = await createPeerlyApp({ dataDirectory });

try {
  await app.listen({ port, host });
  process.stdout.write(`Peerly server listening at http://${host}:${port}\n`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PEERLY_SERVER_PORT must be an integer between 1 and 65535");
  }
  return port;
}
