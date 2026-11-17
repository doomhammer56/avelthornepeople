import * as React from "react";
import Image from "next/image";
import { cn } from "cn";

export type BrandIconName =
  | "meaningful-work"
  | "learning-growth"
  | "collaborative-team"
  | "work-life-balance"
  | "supportive-culture"
  | "business-enquiries"
  | "arrow-right"
  | "chevron-down"
  | "information"
  | "search";

interface BrandIconProps extends Omit<React.ComponentProps<typeof Image>, "src" | "alt"> {
  name: BrandIconName;
  alt?: string;
  size?: number;
}

export function BrandIcon({
  name,
  alt = "",
  size = 40,
  className,
  ...props
}: BrandIconProps) {
  return (
    <Image
      src={`/icons/${name}.svg`}
      alt={alt}
      width={size}
      height={size}
      className={cn("inline-block object-contain shrink-0", className)}
      {...props}
    />
  );
}

