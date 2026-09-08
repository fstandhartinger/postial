import type { HTMLAttributes } from "react";
export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) { return <section className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 ${className}`} {...props} />; }
