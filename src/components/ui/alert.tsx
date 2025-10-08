import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-md border px-4 py-3 text-sm transition-colors",
  {
    variants: {
      variant: {
        default: "border-neutral-200 bg-neutral-50 text-neutral-700",
        info: "border-sky-200 bg-sky-50 text-sky-700",
        warning: "border-amber-300 bg-amber-50 text-amber-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => {
    return <section ref={ref} className={cn(alertVariants({ variant }), className)} {...props} />;
  },
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-semibold", className)} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm leading-relaxed", className)} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
