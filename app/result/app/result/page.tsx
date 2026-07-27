"use client";

import dynamic from "next/dynamic";

// The scorecard lives in sessionStorage, which only exists in the browser, so
// the view is loaded client-side only. That lets it read storage during its
// first render instead of after an effect — no prerender to hydrate against and
// no empty flash before the result appears.
const ResultView = dynamic(
  () => import("@/components/ResultView").then((m) => m.ResultView),
  {
    ssr: false,
    loading: () => (
      <p className="py-20 text-center text-sm text-muted-foreground">
        Loading your result…
      </p>
    ),
  },
);

export default function ResultPage() {
  return <ResultView />;
}
