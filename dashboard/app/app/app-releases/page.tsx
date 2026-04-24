// Plan 5 Phase 1 Task 5.
import { getCurrentRelease } from "@/lib/actions/app-releases";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadForm } from "./upload-form";

export default async function AppReleasesPage() {
  const release = await getCurrentRelease();
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">App Releases</h1>
      <Card>
        <CardHeader>
          <CardTitle>Current release</CardTitle>
        </CardHeader>
        <CardContent>
          {release && release.version_code != null
            ? (
              <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">Version</dt>
                <dd>{release.version_name} (versionCode {release.version_code})</dd>
                <dt className="text-muted-foreground">Published</dt>
                <dd>{release.released_at}</dd>
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="font-mono text-xs break-all">{release.sha256}</dd>
              </dl>
            )
            : <p className="text-muted-foreground text-sm">No APK published yet.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Publish new release</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadForm currentVersionCode={release?.version_code ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
