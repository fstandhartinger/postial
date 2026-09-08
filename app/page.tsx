import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
export default function Home() { return <section className="max-w-3xl py-10 sm:py-20"><Badge>SocialMint</Badge><h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">A calmer home for your social publishing.</h1><p className="mt-6 max-w-xl text-lg leading-8 text-gray-600">Plan, approve and publish social posts across your brands in one workspace.</p><div className="mt-9 flex flex-wrap gap-4"><Link className={buttonClass} href="/login">Start free</Link><Link className="inline-flex items-center rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold" href="/pricing">Pricing</Link></div></section>; }
