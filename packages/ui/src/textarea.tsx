import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@erudane/ui/utils";

const textareaVariants = cva(
  "flex field-sizing-content w-full resize-none text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default:
          "min-h-16 rounded-2xl border border-transparent bg-input/50 px-3 py-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        /** Bare text: the surrounding surface (e.g. the composer card) carries border and focus. */
        ghost: "min-h-8 bg-transparent px-1 py-1",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type TextareaElementProps = Pick<
  ComponentProps<"textarea">,
  "rows" | "cols" | "wrap" | "maxLength" | "minLength"
>;

type TextareaProps = Omit<InputPrimitive.Props, "type"> &
  TextareaElementProps &
  VariantProps<typeof textareaVariants>;

/** Base UI `Input` rendered as a `<textarea>`, so it participates in `Field` / `Form`. */
function Textarea({
  className,
  variant = "default",
  rows,
  cols,
  wrap,
  maxLength,
  minLength,
  ...props
}: TextareaProps) {
  return (
    <InputPrimitive
      data-slot="textarea"
      render={
        <textarea rows={rows} cols={cols} wrap={wrap} maxLength={maxLength} minLength={minLength} />
      }
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
