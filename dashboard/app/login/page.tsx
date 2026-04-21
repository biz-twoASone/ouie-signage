import { sendMagicLink } from "@/lib/actions/auth";
import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          We'll email you a magic link.
        </p>
        <LoginForm action={sendMagicLink} />
      </div>
    </main>
  );
}
