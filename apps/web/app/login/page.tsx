import { LoginForm } from "@/components/login-form";
import { GridPattern } from "@/components/ui/grid-pattern";

export default function Login() {
  return (
    <GridPattern
      className="flex min-h-dvh items-center justify-center px-4 py-8"
      accentColor="var(--primary)"
      fade="bottom"
      size={56}
      speed={1.5}
      squares={20}
    >
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </GridPattern>
  );
}
