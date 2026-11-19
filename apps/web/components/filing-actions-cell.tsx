"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";
import type { FilingDetails } from "@/components/filing-drawer";

type Action = "submit" | "start-review" | "approve" | "reject";
const actionLabels: Record<Action, string> = {
  submit: "submit this filing",
  "start-review": "start review for this filing",
  approve: "approve this filing",
  reject: "reject this filing",
};

export function FilingActionsCell({
  isDraft,
  isAuditor = false,
  status,
  filingId,
  version,
}: {
  isDraft: boolean;
  isAuditor?: boolean;
  status: FilingDetails["status"];
  filingId: string;
  version: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [completedVersion, setCompletedVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completed = completedVersion === version;

  async function perform(action: Action) {
    if (inFlight.current || completed) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const label = actionLabels[action];
    try {
      const response = await fetch(`/api/filings/${encodeURIComponent(filingId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      });
      if (!response.ok) {
        throw new Error(response.status === 409
          ? "This filing has changed. Refresh it before trying again."
          : response.status === 401
            ? "Your session expired. Please sign in again."
            : response.status === 403
              ? `You do not have permission to ${label}.`
              : `Unable to ${label}. Please try again.`);
      }
      setCompletedVersion(version);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${label}. Please try again.`);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const canReview = isAuditor && status === "SUBMITTED";
  const canDecide = isAuditor && status === "UNDER_REVIEW";
  const canSubmit = !isAuditor && isDraft && status === "DRAFT";

  return (
    <TableCell
      className="w-28 pr-5 text-right sm:pr-6"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {(canReview || canDecide || canSubmit) && (
        <div className="flex flex-col items-end gap-2">
          {canReview && <Button type="button" variant="outline" size="sm" onClick={() => perform("start-review")} disabled={pending || completed}>Review</Button>}
          {canDecide && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => perform("approve")} disabled={pending || completed}>Approve</Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => perform("reject")} disabled={pending || completed}>Reject</Button>
            </div>
          )}
          {canSubmit && !completed && <Button type="button" variant="outline" size="sm" onClick={() => perform("submit")} disabled={pending}>Submit</Button>}
          {error && <p role="alert" className="max-w-48 whitespace-normal text-xs text-destructive">{error}</p>}
        </div>
      )}
    </TableCell>
  );
}
