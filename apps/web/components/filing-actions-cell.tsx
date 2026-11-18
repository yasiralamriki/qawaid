"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";

export function FilingActionsCell({ isDraft, filingId, version }: { isDraft: boolean; filingId: string; version: number }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (inFlight.current || submitted) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/filings/${encodeURIComponent(filingId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      });
      if (!response.ok) {
        const message = response.status === 409
          ? "This filing has changed. Refresh it before submitting again."
          : response.status === 401
          ? "Your session expired. Please sign in again."
          : response.status === 403
            ? "You do not have permission to submit this filing."
            : "Unable to submit this filing. Please try again.";
        throw new Error(message);
      }
      setSubmitted(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit this filing. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <TableCell
      className="w-28 pr-5 text-right sm:pr-6"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {isDraft && !submitted && (
        <div className="flex flex-col items-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={submit} disabled={pending}>
            Submit
          </Button>
          {error && <p role="alert" className="max-w-48 whitespace-normal text-xs text-destructive">{error}</p>}
        </div>
      )}
    </TableCell>
  );
}
