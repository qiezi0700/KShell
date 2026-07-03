import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
         "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
      size: {
        // 默认保持原来的小尺寸(24px 高),与现有大量 text-caption 用法兼容
        default: "h-[var(--control-xs)] px-[var(--control-xs-px)] py-[var(--control-xs-py)] text-[var(--control-xs-text)] [&>svg]:size-[var(--control-xs-icon)]",
        sm: "h-[var(--control-sm)] px-[var(--control-sm-px)] py-[var(--control-sm-py)] text-[var(--control-sm-text)] [&>svg]:size-[var(--control-sm-icon)]",
        md: "h-[var(--control-md)] px-[var(--control-md-px)] py-[var(--control-md-py)] text-[var(--control-md-text)] [&>svg]:size-[var(--control-md-icon)]",
        lg: "h-[var(--control-lg)] px-[var(--control-lg-px)] py-[var(--control-lg-py)] text-[var(--control-lg-text)] [&>svg]:size-[var(--control-lg-icon)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
