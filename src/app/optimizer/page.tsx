import { OptimizerApp } from "@/components/optimizer-app";

export default function OptimizerPage() {
  const hasGatewayKey = Boolean(process.env.AI_GATEWAY_API_KEY?.trim());

  return (
    <main className="relative min-h-screen text-neutral-900">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-br from-emerald-50 via-white to-emerald-100"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-12"
        aria-hidden
      >
        <div className="h-72 w-72 rounded-full bg-emerald-200/40 blur-[140px]" />
      </div>
      <div
        className="pointer-events-none absolute -bottom-24 -right-20 hidden h-80 w-80 rounded-full bg-emerald-300/30 blur-[150px] lg:block"
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <OptimizerApp hasGatewayKey={hasGatewayKey} />
      </div>
    </main>
  );
}
