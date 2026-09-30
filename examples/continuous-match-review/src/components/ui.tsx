import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const buttonVariants = {
  primary: "bg-brand-500 text-white shadow-sm hover:bg-brand-600",
  secondary: "border border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50",
  danger: "border border-red-200 bg-white text-red-700 shadow-sm hover:bg-red-50",
  ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
};

const buttonSizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, disabled, className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const badgeTones = {
  gray: "bg-gray-100 text-gray-700 ring-gray-500/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
};

export type Tone = keyof typeof badgeTones;

export function Badge({ tone = "gray", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl border border-gray-200 bg-white shadow-xs", className)}>{children}</section>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNotice({ error, action }: { error: Error | string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{typeof error === "string" ? error : error.message}</div>
      {action}
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** A native modal `<dialog>`: focus trapping, Escape and the backdrop come from the browser. */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-gray-900/40"
    >
      {open && (
        <>
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm text-gray-700">{children}</div>
          {footer && <div className="flex justify-end gap-2 rounded-b-xl border-t border-gray-200 bg-gray-50 px-5 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
