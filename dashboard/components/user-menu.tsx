import { SignOutButton } from "@/components/sign-out-button";

export function UserMenu({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{email}</span>
      <SignOutButton />
    </div>
  );
}
