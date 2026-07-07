"use client";

import { Button } from "@/components/ui/button";

/**
 * Previous / range / Next pagination controls. Per the tray-card pattern the
 * parent places this on a TrayStrip (flex justify-between), never inside the
 * inner card.
 */
export function Pager({
  offset,
  total,
  page,
  onOffset,
}: {
  offset: number;
  total: number;
  page: number;
  onOffset: (offset: number) => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - page))}
      >
        Previous
      </Button>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {total === 0 ? "0 of 0" : `${offset + 1}–${Math.min(offset + page, total)} of ${total}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={offset + page >= total}
        onClick={() => onOffset(offset + page)}
      >
        Next
      </Button>
    </>
  );
}
