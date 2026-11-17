"use client";

import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  label: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  onChange: () => void;
};

// shadcn Checkbox with the row-selection behavior tables need. Clicks never
// bubble, because table rows may navigate on click; the wrapper also catches
// the click base-ui re-dispatches from its hidden form input.
export function AdminSelectCheckbox({
  label,
  checked = false,
  indeterminate = false,
  disabled,
  className,
  onChange,
}: Props) {
  return (
    <span
      className="inline-flex"
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox
        aria-label={label}
        className={className}
        checked={checked}
        indeterminate={indeterminate}
        disabled={disabled}
        onCheckedChange={() => onChange()}
      />
    </span>
  );
}
