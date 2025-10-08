import Image from "next/image";
import Link from "next/link";

const primaryActions = [
  { label: "Open console (BYO API key)", href: "/optimizer", primary: true },
  { label: "View on GitHub", href: "https://github.com/brennanmceachran/gepazilla", primary: false },
];

const highlights = [
  {
    icon: "📦",
    title: "Bring your dataset",
    body: (
      <>
        Load your own rows or start with <code>data/sample-dataset.json</code> to see GEPAzilla in action.
      </>
    ),
  },
  {
    icon: "🧪",
    title: "Composable scoring",
    body: "Mix deterministic checks with LLM judges. Weight and duplicate scorers to match your eval stack.",
  },
  {
    icon: "🔍",
    title: "Local telemetry",
    body: "Every span stays on your machine—tokens, routing, costs, and errors are yours to inspect.",
  },
];

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100 px-6 py-12 text-neutral-900">
      <div className="absolute inset-x-0 top-6 hidden justify-center lg:flex" aria-hidden>
        <div className="h-72 w-72 rounded-full bg-emerald-200/40 blur-[140px]" />
      </div>
      <div className="relative flex w-full max-w-5xl flex-col items-center gap-8 text-center">
        <div className="relative h-72 w-72 sm:h-80 sm:w-80">
          <Image
            src="/gepazilla-logo.png"
            alt="GEPAzilla happily smashing prompts in the GEPA reactor core"
            fill
            className="object-contain drop-shadow-[0_18px_40px_rgba(32,54,36,0.35)]"
            priority
          />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1 text-sm font-medium text-emerald-700">
          <span role="img" aria-hidden>
            🦖
          </span>
          Meet GEPAzilla
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Prompt Optimization with <span className="text-emerald-600">GEPA</span>
        </h1>
        <p className="text-lg text-neutral-600">
          The open-source GEPA prompt optimizer. Feed GEPAzilla a dataset and it will chew through prompts, score them with
          custom metrics, and spit out the strongest contender—feng shui for your system prompt.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                action.primary
                  ? "rounded-full bg-emerald-600 px-7 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(16,185,129,0.35)] transition hover:bg-emerald-700"
                  : "inline-flex items-center gap-2 rounded-full border border-neutral-300 px-7 py-3 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
              }
            >
              {!action.primary && (
                <svg
                  aria-hidden
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="text-neutral-600"
                >
                  <path d="M8 .198a8 8 0 0 0-2.53 15.598c.4.074.547-.174.547-.387 0-.19-.007-.693-.01-1.36-2.225.484-2.695-1.073-2.695-1.073-.364-.924-.89-1.17-.89-1.17-.727-.497.055-.487.055-.487.804.056 1.227.826 1.227.826.715 1.225 1.876.871 2.333.666.072-.518.28-.872.508-1.072-1.777-.202-3.644-.888-3.644-3.953 0-.873.31-1.588.823-2.149-.083-.202-.357-1.016.078-2.118 0 0 .67-.215 2.196.82a7.63 7.63 0 0 1 2-.269c.68.003 1.366.092 2 .269 1.524-1.035 2.193-.82 2.193-.82.436 1.102.162 1.916.08 2.118.513.561.822 1.276.822 2.149 0 3.073-1.87 3.748-3.652 3.946.288.248.543.735.543 1.482 0 1.07-.01 1.934-.01 2.197 0 .215.145.465.55.386A8 8 0 0 0 8 .197Z" />
                </svg>
              )}
              {action.label}
            </Link>
          ))}
        </div>
        <section className="grid w-full gap-4 text-left sm:grid-cols-3">
          {highlights.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/70 bg-white/90 p-5 text-sm text-neutral-600 shadow-[0_12px_32px_rgba(5,46,22,0.1)] backdrop-blur"
            >
              <p className="text-base font-semibold text-neutral-900">
                <span className="mr-2 text-lg" role="img" aria-hidden>
                  {item.icon}
                </span>
                {item.title}
              </p>
              <p className="mt-2 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
