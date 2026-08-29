import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-xs font-medium text-[var(--color-muted)] tracking-wide",
        className,
      )}
      {...props}
    />
  );
}
