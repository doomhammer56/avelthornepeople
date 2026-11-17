"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = { value: string; label: string };
type Props = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

// Shared wrapper around shadcn's official Select, so every dropdown in the
// console (job settings, account roles) looks and behaves the same way.
// The popup is portalled under <body>, which carries the console theme.
export function AdminSelect({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  className,
}: Props) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger className={className ?? "w-full"} aria-label={ariaLabel}>
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
