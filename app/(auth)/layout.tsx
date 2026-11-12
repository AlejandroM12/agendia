import Link from "next/link";
import { brand } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-secondary/30 px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 font-semibold text-foreground">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          A
        </span>
        <span>{brand.name}</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
