"use client";

import { useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type Props = {
  id?: string;
  /** Selected value; "" means the "all" choice. */
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  /** Label of the empty choice, e.g. "All jobs". */
  allLabel: string;
  ariaLabel: string;
  /** Server-side search text and its change handler. */
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Extra content under the list, e.g. previous/next page buttons. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Searchable single-choice picker for long lists. Search is delegated to the
 * caller (the list comes from the server), so Command's own filtering is off.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  search,
  onSearchChange,
  searchPlaceholder,
  emptyLabel,
  footer,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className={cn(
              "w-full justify-between px-3 font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          >
            <span className="truncate">{selected?.label ?? allLabel}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden="true" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 max-w-[90vw] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                value="__all"
                data-checked={value === ""}
                onSelect={() => pick("")}
              >
                {allLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={value === option.value}
                  onSelect={() => pick(option.value)}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {options.length === 0 ? (
              <p className="m-0 px-3 py-4 text-center text-[13px] text-muted-foreground">
                {emptyLabel}
              </p>
            ) : null}
          </CommandList>
          {footer ? (
            <div className="flex items-center justify-between gap-2 border-t border-border p-2">
              {footer}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
