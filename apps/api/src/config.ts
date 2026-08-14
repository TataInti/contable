export interface Config {
  host: string;
  port: number;
  env: string;
}

export function loadConfig(): Config {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: parseInt(process.env.PORT ?? "3000", 10),
    env: process.env.NODE_ENV ?? "development",
  };
}