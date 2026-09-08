import type { InputHTMLAttributes } from "react";
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={`min-h-11 w-full rounded-xl border border-gray-300 px-4 py-2 outline-emerald-600 disabled:bg-gray-100 ${className}`} {...props} />; }
