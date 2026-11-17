import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  /**
   * `dark`: the full lockup on a light surface (header).
   * `light`: the same lockup set on an ivory plate for the navy footer. The
   *   mark is navy and teal, so it cannot sit directly on navy.
   * `symbol`: the TC monogram alone, for tight spaces.
   */
  variant?: "dark" | "light" | "symbol";
  className?: string;
  priority?: boolean;
};

// Wording is part of the artwork, so the alt text carries it for screen readers.
const alt = "AVELTHORNE PEOPLE GROUP";

export function BrandLockup({
  variant = "dark",
  className,
  priority = false,
}: Props) {
  if (variant === "symbol") {
    return (
      <Image
        src="/brand/logo-symbol.webp"
        alt={alt}
        width={1536}
        height={1550}
        priority={priority}
        className={cn("h-10 w-auto object-contain", className)}
      />
    );
  }

  const lockup = (
    <Image
      src="/brand/logo-horizontal.webp"
      alt={alt}
      width={2053}
      height={443}
      priority={priority}
      className={cn(
        "h-8 w-auto object-contain object-left sm:h-9",
        variant === "light" && "h-9 sm:h-10",
        className,
      )}
    />
  );

  return variant === "light" ? (
    <span className="inline-flex rounded-lg bg-[#f4eee4] px-3.5 py-2.5">
      {lockup}
    </span>
  ) : (
    lockup
  );
}
