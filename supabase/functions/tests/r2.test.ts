import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { presignR2GetUrl, presignR2PutUrl } from "../_shared/r2.ts";

Deno.test("presignR2GetUrl returns URL with expected host and query params", async () => {
  const url = await presignR2GetUrl({
    accountId: "acct",
    accessKeyId: "AKIA_FAKE",
    secretAccessKey: "SECRET_FAKE",
    bucket: "signage-media",
    key: "tenants/abc/media/xyz.mp4",
    ttlSeconds: 3600,
  });
  assertStringIncludes(url, "signage-media");
  assertStringIncludes(url, "X-Amz-Expires=3600");
  assertStringIncludes(url, "tenants/abc/media/xyz.mp4");
});

Deno.test("presignR2PutUrl produces a PUT-signed URL", async () => {
  const url = await presignR2PutUrl({
    accountId: "acct",
    accessKeyId: "AKIA_FAKE",
    secretAccessKey: "SECRET_FAKE",
    bucket: "signage-media",
    key: "tenants/abc/media/new.mp4",
    ttlSeconds: 900,
    contentType: "video/mp4",
  });
  assertStringIncludes(url, "X-Amz-Expires=900");
  assertStringIncludes(url, "X-Amz-Algorithm=AWS4-HMAC-SHA256");
});
