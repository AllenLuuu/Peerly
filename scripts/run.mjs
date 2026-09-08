import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const repositoryDirectory = fileURLToPath(new URL("..", import.meta.url));
const taskName = process.argv[2];
const forwardedArguments = process.argv.slice(3);
const tasks = createTasks();
const steps = tasks[taskName];

if (!steps) {
  process.stderr.write(`Unknown repository task: ${taskName ?? "<missing>"}\n`);
  process.exitCode = 1;
} else {
  await runSteps(steps);
}

function createTasks() {
  const pnpm = (arguments_) => packageManagerStep(arguments_);
  const node = (arguments_, options = {}) => ({
    command: process.execPath,
    arguments: arguments_,
    shell: false,
    ...options,
  });

  return {
    build: [pnpm(["-r", "--if-present", "build"])],
    dev: [node(["scripts/dev.mjs"])],
    format: [
      node(["node_modules/prettier/bin/prettier.cjs", "--write", ".", ...forwardedArguments]),
    ],
    "format:check": [
      node(["node_modules/prettier/bin/prettier.cjs", "--check", ".", ...forwardedArguments]),
    ],
    lint: [node(["node_modules/eslint/bin/eslint.js", ".", ...forwardedArguments])],
    "runtime:cli": [
      pnpm(["--filter", "@peerly/runtime-cli...", "build"]),
      node(["--env-file-if-exists=../../.env.local", "dist/index.js"], {
        directory: fileURLToPath(new URL("../apps/runtime-cli", import.meta.url)),
        interactive: true,
      }),
    ],
    "server:start": [
      pnpm(["--filter", "@peerly/server...", "build"]),
      node(["--env-file-if-exists=../../.env.local", "dist/index.js"], {
        directory: fileURLToPath(new URL("../apps/server", import.meta.url)),
      }),
    ],
    "smoke:agent": [
      pnpm(["--filter", "@peerly/server...", "build"]),
      node(["--env-file-if-exists=.env.local", "scripts/agent-chat-smoke.mjs"]),
    ],
    "smoke:counting": [
      pnpm(["--filter", "@peerly/server...", "build"]),
      node(["--env-file-if-exists=.env.local", "scripts/agent-counting-smoke.mjs"]),
    ],
    test: [node(["node_modules/vitest/vitest.mjs", "run", ...forwardedArguments])],
    typecheck: [pnpm(["-r", "--if-present", "typecheck"])],
  };
}

function packageManagerStep(arguments_) {
  const executable = process.env.npm_execpath;
  if (executable) {
    if (/\.(?:cjs|mjs|js)$/iu.test(executable)) {
      return { command: process.execPath, arguments: [executable, ...arguments_], shell: false };
    }
    if (!/\.(?:cmd|ps1|bat)$/iu.test(executable)) {
      return { command: executable, arguments: arguments_, shell: false };
    }
  }

  if (process.platform === "win32") {
    const powershellShim = findOnPath("pnpm.ps1");
    if (powershellShim) {
      return {
        command: "powershell.exe",
        arguments: ["-NoLogo", "-NoProfile", "-File", powershellShim, ...arguments_],
        shell: false,
      };
    }
  }

  return { command: "pnpm", arguments: arguments_, shell: false };
}

function findOnPath(fileName) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function runSteps(taskSteps) {
  let activeChild;
  let activeStep;
  let shuttingDown = false;
  let requestedExitCode = 0;
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
  process.once("SIGINT", handleSignalInterrupt);
  process.once("SIGTERM", () => requestShutdown(0));

  let taskExitCode = 0;
  for (const step of taskSteps) {
    if (shuttingDown) break;
    activeStep = step;
    taskExitCode = await runStep(step);
    activeStep = undefined;
    if (taskExitCode !== 0) break;
  }

  restoreConsoleInput();
  process.exitCode = shuttingDown ? requestedExitCode : taskExitCode;

  function runStep(step) {
    return new Promise((resolve) => {
      const child = spawn(step.command, step.arguments, {
        cwd: step.directory ?? repositoryDirectory,
        env: process.env,
        shell: step.shell,
        stdio: [
          capturesWindowsInterrupt ? (step.interactive ? "pipe" : "ignore") : "inherit",
          "inherit",
          "inherit",
        ],
      });
      activeChild = child;
      let spawnError = false;

      child.once("error", (error) => {
        spawnError = true;
        process.stderr.write(`Failed to start ${step.command}: ${error.message}\n`);
      });
      child.once("close", (code) => {
        if (activeChild === child) activeChild = undefined;
        resolve(spawnError ? 1 : (code ?? 1));
      });
    });
  }

  function handleConsoleInput(data) {
    if (activeStep?.interactive && activeChild?.stdin?.writable) {
      activeChild.stdin.write(data);
    } else if (data.includes(3)) {
      requestShutdown(0);
    }
  }

  function handleSignalInterrupt() {
    if (!activeStep?.interactive) requestShutdown(0);
  }

  function requestShutdown(code) {
    if (!shuttingDown) {
      shuttingDown = true;
      requestedExitCode = code;
    }
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      stopChild(activeChild);
    }
  }

  function restoreConsoleInput() {
    if (!capturesWindowsInterrupt || !process.stdin.isRaw) return;
    process.stdin.off("data", handleConsoleInput);
    process.stdin.pause();
    process.stdin.setRawMode(false);
  }
}

function stopChild(child) {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }

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
