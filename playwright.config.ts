import { defineConfig, devices } from "@playwright/test";

const externalStack = process.env.E2E_EXTERNAL === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalStack ? undefined : [
    {
      command: "npm run dev -w @contable/api",
      url: "http://127.0.0.1:3000/health/live",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        RUNTIME_DATABASE_URL: "postgresql://contable_runtime:runtime_secret@localhost:5432/contable",
        REDIS_URL: "redis://localhost:6379",
        AI_SERVICE_URL: "http://localhost:8000",
        AI_SERVICE_SECRET: "dev-secret",
        MFA_CHALLENGE_SECRET: "e2e-mfa-challenge-secret-with-32-characters",
      },
    },
    {
      command: "npm run dev -w @contable/web -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/login",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
