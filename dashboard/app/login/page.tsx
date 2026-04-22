import { copy } from "@/lib/copy";
import { sendMagicLink } from "@/lib/actions/auth";
import { LoginForm } from "./form";
import { Monitor } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="bg-primary/10 text-primary rounded-xl p-3">
            <Monitor className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {copy.productName}
            </h1>
            <p className="text-muted-foreground text-sm">
              Sign in with a magic link.
            </p>
          </div>
        </div>
        <LoginForm action={sendMagicLink} />
        <p className="text-muted-foreground text-center text-xs">
          By signing in you agree to the terms of service.
        </p>
      </div>
    </main>
  );
}
