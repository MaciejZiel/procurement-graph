import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = fileURLToPath(new URL(".", import.meta.url));
const projectDir = resolve(frontendDir, "..");
const backendDir = resolve(projectDir, "backend");
const python = resolve(backendDir, ".venv/bin/uvicorn");
const vite = resolve(frontendDir, "node_modules/vite/bin/vite.js");

if (!existsSync(python)) {
  console.error("Missing backend/.venv. Create the environment and install dependencies as described in README.");
  process.exit(1);
}

mkdirSync(resolve(projectDir, "data"), { recursive: true });

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? `sqlite:///${resolve(projectDir, "data/local.db")}`,
  CORS_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173",
};

const api = spawn(python, ["app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
  cwd: backendDir,
  env,
  stdio: "inherit",
});
const web = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", "5173"], {
  cwd: frontendDir,
  env: { ...env, VITE_API_URL: "" },
  stdio: "inherit",
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => {
  if (!stopping) {
    process.exitCode = code ?? 1;
    stop();
  }
});
web.on("exit", (code) => {
  if (!stopping) {
    process.exitCode = code ?? 1;
    stop();
  }
});

console.log("Procurement Graph: http://localhost:5173 · API docs: http://localhost:8000/docs");
