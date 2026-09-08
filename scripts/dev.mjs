import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { get } from "node:http";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";

const services = [
  {
    name: "server",
    directory: fileURLToPath(new URL("../apps/server", import.meta.url)),
    arguments: ["--env-file-if-exists=../../.env.local", "--import", "tsx", "src/index.ts"],
  },
  {
    name: "web",
    directory: fileURLToPath(new URL("../apps/web", import.meta.url)),
    arguments: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--clearScreen", "false"],
  },
];

const children = new Map();
const expectedStops = new WeakSet();
let serverSourceWatcher;
let serverRestartTimer;
let serverRestarting = false;
let shuttingDown = false;
let exitCode = 0;

// pnpm's Windows version shim and lifecycle runner use cmd.exe. Reading Ctrl+C
// as raw input prevents the event from reaching those batch layers and prompting.
const capturesWindowsInterrupt =
  process.platform === "win32" &&
  process.stdin.isTTY &&
  typeof process.stdin.setRawMode === "function";

if (capturesWindowsInterrupt) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", handleConsoleInput);
  process.once("exit", restoreConsoleInput);
}

process.once("SIGINT", () => requestShutdown(0));
process.once("SIGTERM", () => requestShutdown(0));

startService(services[0]);
try {
  await waitForServerReady();
} catch (error) {
  if (!shuttingDown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    requestShutdown(1);
  }
}
if (!shuttingDown) {
  watchServerSource();
  startService(services[1]);
}

function startService(service) {
  const child = spawn(process.execPath, service.arguments, {
    cwd: service.directory,
    env: process.env,
    stdio: [capturesWindowsInterrupt ? "ignore" : "inherit", "inherit", "inherit"],
    shell: false,
  });
  children.set(child, service);

  child.once("error", (error) => {
    process.stderr.write(`Failed to start ${service.name}: ${error.message}\n`);
    requestShutdown(1);
  });
  child.once("close", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && !expectedStops.has(child)) {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      process.stderr.write(`${service.name} stopped unexpectedly (${reason}).\n`);
      requestShutdown(code === 0 ? 1 : (code ?? 1));
    }
    finishWhenStopped();
  });

  return child;
}

function watchServerSource() {
  serverSourceWatcher = watch(
    fileURLToPath(new URL("../apps/server/src", import.meta.url)),
    { recursive: true },
    (_eventType, filename) => {
      if (shuttingDown || serverRestarting) return;
      if (filename && !/\.(?:json|ts|tsx)$/u.test(filename)) return;
      clearTimeout(serverRestartTimer);
      serverRestartTimer = setTimeout(restartServer, 150);
    },
  );
  serverSourceWatcher.once("error", (error) => {
    process.stderr.write(`Server source watcher failed: ${error.message}\n`);
    requestShutdown(1);
  });
}

function restartServer() {
  serverRestartTimer = undefined;
  const runningServer = [...children].find(([, service]) => service.name === "server");
  if (!runningServer || shuttingDown) return;

  const [child] = runningServer;
  serverRestarting = true;
  expectedStops.add(child);
  child.once("close", () => {
    serverRestarting = false;
    if (!shuttingDown) startService(services[0]);
  });
  stopChild(child);
}

async function waitForServerReady() {
  const deadline = Date.now() + 30_000;
  while (!shuttingDown && Date.now() < deadline) {
    if (await serverIsReady()) return;
    await delay(100);
  }
  if (!shuttingDown) {
    throw new Error("Peerly server did not become ready at http://127.0.0.1:3000 within 30s");
  }
}

function serverIsReady() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };
    const request = get("http://127.0.0.1:3000/health", (response) => {
      response.resume();
      finish(response.statusCode === 200);
    });
    request.setTimeout(1_000, () => {
      request.destroy();
      finish(false);
    });
    request.once("error", () => finish(false));
  });
}

function requestShutdown(code) {
  if (!shuttingDown) {
    shuttingDown = true;
    exitCode = code;
  } else if (exitCode === 0 && code !== 0) {
    exitCode = code;
  }

  clearTimeout(serverRestartTimer);
  serverSourceWatcher?.close();
  serverSourceWatcher = undefined;

  for (const child of children.keys()) {
    if (child.exitCode === null && child.signalCode === null) {
      stopChild(child);
    }
  }
  finishWhenStopped();
}

function finishWhenStopped() {
  if (!shuttingDown || children.size > 0) return;
  restoreConsoleInput();
  process.exitCode = exitCode;
}

function handleConsoleInput(data) {
  if (data.includes(3)) requestShutdown(0);
}

function restoreConsoleInput() {
  if (!capturesWindowsInterrupt || !process.stdin.isRaw) return;
  process.stdin.off("data", handleConsoleInput);
  process.stdin.pause();
  process.stdin.setRawMode(false);
}

function stopChild(child) {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }

  // Stop the complete, exact process tree in case a service has its own workers.
  const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.once("error", () => child.kill("SIGTERM"));
  killer.once("exit", (code) => {
    if (code !== 0 && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  });
}
