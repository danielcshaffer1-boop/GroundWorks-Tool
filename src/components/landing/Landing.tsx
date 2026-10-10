import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { TryDemoButton } from "./TryDemoButton";

// Signed-out front door for groundworksinventory.dev. Server component: all
// static, the only client piece is the demo button. Shape rule for the page:
// cards and panels are rounded-2xl, buttons are full pills, nothing else.

const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const display = "font-display tracking-tight";
const primaryCta =
  "inline-flex items-center justify-center min-h-12 px-6 rounded-full bg-gw-accent text-gw-bg font-mono text-sm font-semibold transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-60";
const secondaryCta =
  "inline-flex items-center justify-center gap-2 min-h-12 pr-2 rounded-full text-gw-text-2 font-mono text-sm underline underline-offset-4 decoration-gw-border-strong transition-colors hover:text-gw-text active:scale-[0.97]";
const outlineCta =
  "inline-flex items-center justify-center min-h-12 px-6 rounded-full border border-gw-border-strong text-gw-text font-mono text-sm font-semibold transition-[background-color,transform] duration-150 hover:bg-gw-surface-selected active:scale-[0.97]";

// The exact text format the alert route sends (src/app/api/alerts/item-updated).
const SAMPLE_TEXT =
  "GroundWorks Inventory: Whole Milk is now Critical — 1.5 gallon left (threshold 4). Reply STOP to opt out.";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gw-bg text-gw-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-gw-accent focus:px-4 focus:py-2 focus:text-gw-bg"
      >
        Skip to content
      </a>

      {/* Navigation */}
      <header className="border-b border-gw-border">
        <div className={`${container} flex h-16 items-center justify-between`}>
          <Link href="/" className={`${display} text-2xl font-bold tracking-wide`} aria-label="GroundWorks Inventory home">
            GROUNDWORKS
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-3 font-mono text-sm">
            <a href="#how-it-works" className="hidden sm:inline-flex min-h-11 items-center px-3 text-gw-text-2 hover:text-gw-text">
              How it works
            </a>
            <a href="#pricing" className="hidden sm:inline-flex min-h-11 items-center px-3 text-gw-text-2 hover:text-gw-text">
              Pricing
            </a>
            <Link href="/login" className="inline-flex min-h-11 items-center px-3 text-gw-text hover:text-gw-accent-text">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className={`${container} grid items-center gap-12 pt-12 pb-20 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pb-24`}>
          <div className="gw-rise">
            <h1 className={`${display} text-[clamp(3.25rem,9vw,5.75rem)] font-bold leading-[0.92]`}>
              Know you&rsquo;re low.
              <br />
              Before you&rsquo;re out.
            </h1>
            <p className="mt-6 max-w-[36ch] text-lg leading-relaxed text-gw-text-2">
              Count your stock in under a minute. GroundWorks texts you before the shelf runs empty.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2">
              <TryDemoButton className={primaryCta}>Try the demo</TryDemoButton>
              <Link href="/signup" className={secondaryCta}>
                Create your shop <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="gw-rise gw-rise-2 relative mx-auto w-full max-w-[320px] lg:mr-0">
            <div className="relative h-[520px] overflow-hidden rounded-[2rem] border border-gw-border-strong shadow-[0_40px_90px_-30px_rgba(193,102,59,0.35)]">
              <Image
                src="/landing/app-list.jpg"
                alt="The GroundWorks inventory list on a phone: whole milk marked critical, oat milk stocked, half and half marked reorder soon, each with a colored status stamp."
                width={750}
                height={1624}
                priority
                sizes="320px"
                className="h-auto w-full"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-gw-bg to-transparent" />
            </div>
            <figure className="absolute -left-3 bottom-12 w-[250px] -rotate-2 rounded-2xl border border-dashed border-gw-border-strong bg-gw-surface-raised p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] sm:-left-24 sm:w-[270px]">
              <blockquote className="font-mono text-[13px] leading-relaxed text-gw-text">{SAMPLE_TEXT}</blockquote>
            </figure>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-gw-border">
          <div className={`${container} grid gap-12 py-20 sm:py-28 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20`}>
            <div className="self-start lg:sticky lg:top-24">
              <h2 className={`${display} text-balance text-4xl font-bold leading-[0.98] sm:text-6xl`}>A shift takes about a minute.</h2>
              <p className="mt-5 max-w-[38ch] text-base leading-relaxed text-gw-text-2">
                No spreadsheet to update and nothing to remember to check.
              </p>
            </div>
            <ol className="space-y-12">
              <li className="gw-reveal border-l-2 border-gw-border-strong pl-6">
                <h3 className={`${display} text-3xl font-bold`}>Set your par levels</h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-gw-text-2">
                  Tell GroundWorks how much of each item you want on hand. Anything that gets low is marked Reorder
                  Soon, and anything lower is marked Critical.
                </p>
              </li>
              <li className="gw-reveal border-l-2 border-gw-border-strong pl-6">
                <h3 className={`${display} text-3xl font-bold`}>Count at close</h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-gw-text-2">
                  Walk the storage room and enter what is there. Type it in cartons or in ounces, whichever you count
                  in.
                </p>
              </li>
              <li className="gw-reveal border-l-2 border-gw-accent pl-6">
                <h3 className={`${display} text-3xl font-bold`}>Get the text</h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-gw-text-2">
                  When an item crosses into Reorder Soon or Critical, a text goes to the numbers you chose. One text
                  per change, never a repeat while it sits there.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-gw-border">
          <div className={`${container} py-20 sm:py-28`}>
            <h2 className={`${display} max-w-[22ch] text-balance text-4xl font-bold leading-[0.98] sm:text-6xl`}>
              Made for the back of house.
            </h2>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {/* Alerts */}
              <article className="gw-reveal relative overflow-hidden rounded-2xl border border-gw-border bg-gradient-to-br from-[#2b1d15] via-gw-surface to-gw-surface p-7 sm:p-9 md:col-span-2">
                <h3 className={`${display} text-3xl font-bold`}>Texts that beat the rush</h3>
                <p className="mt-2 max-w-[48ch] leading-relaxed text-gw-text-2">
                  Reorder and critical alerts reach every number you add. Expiring batches get their own heads-up, a
                  few days ahead.
                </p>
                <blockquote className="mt-7 max-w-[44ch] rounded-2xl border border-dashed border-gw-border-strong bg-gw-bg/60 p-4 font-mono text-[13px] leading-relaxed">
                  {SAMPLE_TEXT}
                </blockquote>
              </article>

              {/* Batches (image, spans two rows) */}
              <article className="gw-reveal flex flex-col overflow-hidden rounded-2xl border border-gw-border bg-gw-surface md:row-span-2">
                <div className="p-7 pb-5 sm:p-9 sm:pb-6">
                  <h3 className={`${display} text-3xl font-bold`}>Oldest batch first</h3>
                  <p className="mt-2 leading-relaxed text-gw-text-2">
                    Track expiration by batch. The one to use next is marked, and counts draw from it automatically.
                  </p>
                </div>
                <div className="relative mt-auto h-[340px] overflow-hidden px-7 sm:px-9">
                  <Image
                    src="/landing/app-batches.jpg"
                    alt="The batch editor for whole milk: a labeled Sysco delivery batch with two days left marked Used next, and a Walk-in cooler batch with eight days left."
                    width={750}
                    height={1624}
                    sizes="(min-width: 768px) 320px, 90vw"
                    className="h-auto w-full rounded-t-xl border border-b-0 border-gw-border-strong"
                  />
                </div>
              </article>

              {/* Count or amount */}
              <article className="gw-reveal rounded-2xl border border-gw-border bg-gw-surface-raised p-7 sm:p-9">
                <h3 className={`${display} text-3xl font-bold`}>Count or amount</h3>
                <p className="mt-2 leading-relaxed text-gw-text-2">
                  Switch between cartons and ounces in one tap. Closing counts work in either.
                </p>
                <p className="mt-6 font-mono text-gw-text" aria-label="6 cartons equals 192 ounces">
                  <span className="text-3xl">6</span> <span className="text-sm text-gw-text-3">carton</span>
                  <span className="mx-3 text-gw-border-strong" aria-hidden="true">
                    /
                  </span>
                  <span className="text-3xl">192</span> <span className="text-sm text-gw-text-3">oz</span>
                </p>
              </article>

              {/* Recipes */}
              <article className="gw-reveal rounded-2xl border border-gw-border bg-gw-surface p-7 sm:p-9 [background-image:repeating-linear-gradient(135deg,transparent_0_14px,rgba(237,227,211,0.035)_14px_15px)]">
                <h3 className={`${display} text-3xl font-bold`}>Recipes, on Pro</h3>
                <p className="mt-2 leading-relaxed text-gw-text-2">
                  Paste your end-of-shift sales. The milk, beans and syrup come off the shelf for you.
                </p>
                <pre className="mt-6 whitespace-pre-wrap rounded-xl bg-gw-bg/70 p-4 font-mono text-[13px] leading-relaxed text-gw-text">
                  {"Vanilla Latte, 24\nOat Milk Latte, 17"}
                </pre>
              </article>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-gw-border">
          <div className={`${container} py-20 sm:py-28`}>
            <h2 className={`${display} text-balance text-4xl font-bold leading-[0.98] sm:text-6xl`}>Two plans, one setup fee.</h2>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-gw-text-2">
              Billed monthly. A one-time $200 setup fee is added to your first month.
            </p>

            <div className="mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
              <article className="gw-reveal flex flex-col rounded-2xl border border-gw-border bg-gw-surface p-7 sm:p-9">
                <h3 className="font-mono text-sm uppercase tracking-widest text-gw-text-2">Standard</h3>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className={`${display} text-6xl font-bold`}>$40</span>
                  <span className="font-mono text-sm text-gw-text-3">per month</span>
                </p>
                <ul className="mt-7 space-y-3 text-gw-text-2">
                  {[
                    "Quick counts and closing counts",
                    "Text alerts for low and critical stock",
                    "Batch tracking with expiration alerts",
                    "Sortable spreadsheet view",
                  ].map((line) => (
                    <li key={line} className="flex gap-3">
                      <Check size={18} className="mt-0.5 shrink-0 text-gw-ok" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`${outlineCta} mt-9`}>
                  Create your shop
                </Link>
              </article>

              <article className="gw-reveal flex flex-col rounded-2xl border border-gw-accent bg-gw-surface-raised p-7 sm:p-9">
                <h3 className="font-mono text-sm uppercase tracking-widest text-gw-accent-text">Pro</h3>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className={`${display} text-6xl font-bold`}>$50</span>
                  <span className="font-mono text-sm text-gw-text-3">per month</span>
                </p>
                <ul className="mt-7 space-y-3 text-gw-text-2">
                  {["Everything in Standard", "Recipes that deduct ingredients", "End-of-shift sales import"].map(
                    (line) => (
                      <li key={line} className="flex gap-3">
                        <Check size={18} className="mt-0.5 shrink-0 text-gw-accent-text" aria-hidden="true" />
                        <span>{line}</span>
                      </li>
                    )
                  )}
                </ul>
                <Link href="/signup" className={`${primaryCta} mt-auto`}>
                  Create your shop
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="border-t border-gw-border">
          <div className={`${container} py-20 sm:py-28`}>
            <div className="rounded-2xl border border-gw-border bg-gradient-to-br from-[#2b1d15] via-gw-surface to-gw-surface p-8 sm:p-14">
              <h2 className={`${display} max-w-[16ch] text-balance text-4xl font-bold leading-[0.98] sm:text-6xl`}>
                See it with real counts.
              </h2>
              <p className="mt-5 max-w-[44ch] leading-relaxed text-gw-text-2">
                The demo is a working shop. Tap around, change a count, no signup.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2">
                <TryDemoButton className={primaryCta}>Try the demo</TryDemoButton>
                <Link href="/signup" className={secondaryCta}>
                  Create your shop <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gw-border">
        <div className={`${container} flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <p className={`${display} text-xl font-bold tracking-wide`}>GROUNDWORKS</p>
            <p className="mt-1 text-sm text-gw-text-3">&copy; 2026 GroundWorks Inventory</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-2 font-mono text-sm text-gw-text-2">
            <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-gw-text">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center px-2 hover:text-gw-text">
              Terms
            </Link>
            <a href="mailto:danielcshaffer1@gmail.com" className="inline-flex min-h-11 items-center px-2 hover:text-gw-text">
              danielcshaffer1@gmail.com
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
