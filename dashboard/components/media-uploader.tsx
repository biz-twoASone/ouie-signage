"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestUploadUrl, finalizeMedia } from "@/lib/actions/media";

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function videoDurationSeconds(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return undefined;
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("video metadata failed"));
    });
    return Math.round(v.duration);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MediaUploader() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  async function handleUpload(file: File) {
    setStatus("Preparing upload…");
    setProgress(0);

    const r = await requestUploadUrl({
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
    if ("error" in r) { setStatus(`Error: ${r.error}`); return; }

    setStatus("Uploading to R2…");
    const put = await fetch(r.upload_url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    });
    if (!put.ok) {
      setStatus(`Upload failed: ${put.status}`);
      return;
    }

    setStatus("Computing checksum…");
    const checksum = await sha256Hex(file);
    const duration = await videoDurationSeconds(file);

    setStatus("Finalizing…");
    const fin = await finalizeMedia({
      media_id: r.media_id,
      checksum_sha256: checksum,
      duration_seconds: duration,
    });
    if (fin && "error" in fin && fin.error) {
      setStatus(`Finalize failed: ${fin.error}`);
      return;
    }
    setStatus("Done.");
    setProgress(100);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="border rounded p-4 space-y-3">
      <h2 className="font-medium">Upload media</h2>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
      />
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
      {progress > 0 && progress < 100 && <progress value={progress} max={100} className="w-full" />}
    </div>
  );
}
