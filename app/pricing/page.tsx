import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
export default function Pricing() { return <div className="mx-auto max-w-3xl"><h1 className="text-4xl font-semibold tracking-tight">Room for every brand.</h1><p className="mt-4 text-gray-600">{TRIAL_DAYS} days free. No card required.</p><div className="mt-10 grid gap-6 sm:grid-cols-2">{Object.values(PLANS).map(plan => <Card key={plan.name}><h2 className="text-xl font-semibold">{plan.name}</h2><p className="my-6"><span className="text-4xl font-semibold">€{plan.monthlyPriceEur}</span><span className="text-gray-500"> / month</span></p><Link href="/login" className={buttonClass}>Start free</Link></Card>)}</div></div>; }
