import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function endpoint(cfg: R2Config): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
}

export async function presignR2GetUrl(params: R2Config & { key: string; ttlSeconds: number }): Promise<string> {
  const client = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`${endpoint(params)}/${params.key}`);
  url.searchParams.set("X-Amz-Expires", String(params.ttlSeconds));
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function presignR2PutUrl(params: R2Config & {
  key: string; ttlSeconds: number; contentType: string;
}): Promise<string> {
  const client = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`${endpoint(params)}/${params.key}`);
  url.searchParams.set("X-Amz-Expires", String(params.ttlSeconds));
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": params.contentType },
    aws: { signQuery: true },
  });
  return signed.url;
}

export function r2ConfigFromEnv(): R2Config {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET must be set",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}
