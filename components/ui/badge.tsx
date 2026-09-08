import type { HTMLAttributes } from "react";
export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) { return <span className={`inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ${className}`} {...props} />; }
