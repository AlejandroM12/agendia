import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

type Props = Omit<React.ComponentProps<"a">, "href"> &
  VariantProps<typeof buttonVariants> & { href: string };

/**
 * Enlace con aspecto de botón. Es un `<a>` real (rol "link"), no un botón:
 * los lectores de pantalla y el teclado lo tratan como navegación.
 */
export function ButtonLink({ href, variant = "default", size = "default", className, children, ...props }: Props) {
  const classes = cn(buttonVariants({ variant, size }), className);
  const internal = href.startsWith("/") || href.startsWith("#");
  return internal ? (
    <Link href={href} className={classes} {...props}>
      {children}
    </Link>
  ) : (
    <a href={href} className={classes} {...props}>
      {children}
    </a>
  );
}
