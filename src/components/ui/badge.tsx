import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors backdrop-blur-sm",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-transparent",
        secondary: "bg-secondary/60 text-secondary-foreground border-transparent",
        outline: "text-foreground bg-glass-bg/20",
        success: "bg-status-success/10 text-status-success border-status-success/30",
        warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
        error: "bg-status-error/10 text-status-error border-status-error/30",
        info: "bg-status-info/10 text-status-info border-status-info/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
