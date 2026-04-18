import { spawn } from "node:child_process";
import { createServer } from "node:net";

function getMode(rawMode) {
  return rawMode === "live" ? "live" : "mock";
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve free port.")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

const mode = getMode(process.argv[2]);
const extraArgs = process.argv.slice(3);
const port = await findFreePort();
const baseUrl = `http://localhost:${port}`;

const child = spawn(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--config=playwright.config.ts",
    `--project=${mode}`,
    ...extraArgs,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_MODE: mode,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_BASE_URL: baseUrl,
    },
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
