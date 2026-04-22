import { AwsClient } from "aws4fetch";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function endpoint(): string {
  return `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${requireEnv("R2_BUCKET")}`;
}

export async function r2Delete(key: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
  const url = `${endpoint()}/${key}`;
  const signed = await client.sign(url, { method: "DELETE" });
  const res = await fetch(signed.url, { method: "DELETE", headers: signed.headers });
  // S3-compatible DELETE returns 204 on success and 404 if already gone — both
  // are acceptable idempotent "ensure key is gone" outcomes.
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
  }
}
