import type { ReactNode } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Props = {
  label: ReactNode;
  /** Id of the control inside, so clicking the label focuses it. */
  htmlFor?: string;
  hint?: ReactNode;
  /** Id placed on the hint so a control can reference it with aria-describedby. */
  hintId?: string;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint/error, laid out the same way on every form. */
export function FormField({
  label,
  htmlFor,
  hint,
  hintId,
  error,
  required,
  className,
  children,
}: Props) {
  return (
    <Field
      data-invalid={error ? true : undefined}
      className={cn("gap-1.5", className)}
    >
      <FieldLabel
        htmlFor={htmlFor}
        className="text-[13px] font-medium text-foreground/80"
      >
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </FieldLabel>
      {children}
      {hint ? (
        <FieldDescription id={hintId} className="text-xs">
          {hint}
        </FieldDescription>
      ) : null}
      {error ? <FieldError className="text-xs">{error}</FieldError> : null}
    </Field>
  );
}
