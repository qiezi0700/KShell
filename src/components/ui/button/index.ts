import { cva, type VariantProps } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border border-border bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 默认按钮:32px 高
        default: 'h-[var(--control-md)] px-[var(--control-md-px)] py-[var(--control-md-py)] text-[var(--control-md-text)] [&_svg]:size-[var(--control-md-icon)]',
        // 紧凑按钮:28px 高
        sm: 'h-[var(--control-sm)] px-[var(--control-sm-px)] py-[var(--control-sm-py)] text-[var(--control-sm-text)] [&_svg]:size-[var(--control-sm-icon)]',
        // 大型按钮:36px 高
        lg: 'h-[var(--control-lg)] px-[var(--control-lg-px)] py-[var(--control-lg-py)] text-[var(--control-lg-text)] [&_svg]:size-[var(--control-lg-icon)]',
        // 常规工具条图标按钮(顶栏、Dialog 内):28×28
        icon: 'h-[var(--control-sm)] w-[var(--control-sm)] rounded-md p-0 [&_svg]:size-[var(--control-sm-icon)]',
        // 密集列表/子面板图标按钮(SFTP 行、TransferPanel):24×24
        'icon-sm': 'h-[var(--control-xs)] w-[var(--control-xs)] rounded-md p-0 [&_svg]:size-[var(--control-xs-icon)]',
        // 密集文本按钮:24 高
        xs: 'h-[var(--control-xs)] px-[var(--control-xs-px)] py-[var(--control-xs-py)] text-[var(--control-xs-text)] gap-1 [&_svg]:size-[var(--control-xs-icon)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
