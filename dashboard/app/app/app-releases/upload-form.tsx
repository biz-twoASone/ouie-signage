// Plan 5 Phase 1 Task 5.
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publishApkRelease, requestApkUploadUrl } from "@/lib/actions/app-releases";

async function computeSha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function UploadForm({ currentVersionCode }: { currentVersionCode: number | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [versionCode, setVersionCode] = useState<string>("");
  const [versionName, setVersionName] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose an APK file");
    const vc = Number(versionCode);
    if (!Number.isInteger(vc) || vc <= 0) return setError("versionCode must be a positive integer");
    if (currentVersionCode != null && vc <= currentVersionCode) {
      return setError(`versionCode must exceed current (${currentVersionCode})`);
    }
    const versionNameTrimmed = versionName.trim();
    if (!versionNameTrimmed) return setError("versionName required");

    try {
      setProgress("Computing checksum…");
      const sha256 = await computeSha256Hex(file);

      setProgress("Requesting upload URL…");
      const uploadResp = await requestApkUploadUrl({
        versionCode: vc,
        sizeBytes: file.size,
      });
      if ("error" in uploadResp) throw new Error(uploadResp.error);

      setProgress(`Uploading ${(file.size / 1024 / 1024).toFixed(1)} MB to R2…`);
      const putRes = await fetch(uploadResp.upload_url, {
        method: "PUT",
        headers: { "content-type": "application/vnd.android.package-archive" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`R2 PUT failed: ${putRes.status}`);

      setProgress("Publishing pointer…");
      const publishResp = await publishApkRelease({
        versionCode: vc,
        versionName: versionNameTrimmed,
        r2Path: uploadResp.r2_path,
        sha256,
      });
      if ("error" in publishResp) throw new Error(publishResp.error);

      setProgress("Done. Devices will install on next config poll (≤60s).");
      setFile(null);
      setVersionCode("");
      setVersionName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="apk-file">APK file</Label>
        <Input
          id="apk-file"
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="version-code">versionCode (integer)</Label>
        <Input
          id="version-code"
          type="number"
          value={versionCode}
          onChange={(e) => setVersionCode(e.target.value)}
          className="w-32"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="version-name">versionName (e.g. 0.5.0)</Label>
        <Input
          id="version-name"
          type="text"
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
          className="w-48"
        />
      </div>
      <Button type="submit">Upload + Publish</Button>
      {progress && <p className="text-muted-foreground text-sm">{progress}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
