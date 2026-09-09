import type { ButtonHTMLAttributes } from "react";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] bg-emerald-700 px-4 py-2 text-base font-medium text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-600";
export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      className={`${buttonClass} ${variant === "secondary" ? "!border !border-zinc-500 !bg-white !text-zinc-950 hover:!bg-zinc-100" : ""} ${className}`}
      {...props}
    />
  );
}
