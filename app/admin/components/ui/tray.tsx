import * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Tray-card pattern: a soft gray tray (casts the only shadow) with a flat
 * white inner card floating inside it. Secondary content — titles, deltas,
 * pagination — sits directly on the tray via TrayStrip, never inside the
 * inner card.
 */
function Tray({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn("gap-0 bg-muted/50 p-1 ring-0 shadow-sm", className)}
      {...props}
    />
  );
}

/** Flat white inner panel — no border, ring, or shadow of its own. */
function TrayInner({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl bg-card p-4", className)} {...props} />;
}

/** Content strip on the tray itself; aligns with the inner card's p-4. */
function TrayStrip({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-4 py-2.5", className)} {...props} />;
}

/** Mono uppercase micro-label for panel titles and KPI labels. */
function TrayLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] tracking-wide text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export { Tray, TrayInner, TrayStrip, TrayLabel };
