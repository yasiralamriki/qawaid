"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileClock, LoaderCircle, PenBox, X } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

interface AuditEvent {
  id: string;
  action: string;
  actorId: string;
  previousState: string | null;
  newState: string | null;
  timestamp: string | null;
}

export interface FilingDetails {
  id: string;
  title: string;
  category: string;
  status: "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | null;
  version: number;
  tenantId: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expirationDate: string | null;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

export function FilingDrawer({
  filing,
  children,
  canEdit = false,
}: {
  filing: FilingDetails;
  children: ReactNode;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<"title" | "category" | "expirationDate" | null>(null);
  const [editValue, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/filings/${encodeURIComponent(filing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: filing.version, [editing]: editing === "expirationDate" ? editValue : editValue.trim() }),
      });
      if (!response.ok) throw new Error(response.status === 409
        ? "This filing has changed. Refresh before saving again. Your entered value has been kept."
        : response.status === 403
        ? "You do not have permission to edit this filing."
        : "Unable to save. Check the value and try again.");
      setEditing(null);
      setAttempt((value) => value + 1);
      router.refresh();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const filingId = filing.id;
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    async function loadHistory() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/filings/${encodeURIComponent(filingId)}/audit-history`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Unable to load audit history.");
        const data: AuditEvent[] = await response.json();
        if (!controller.signal.aborted) setEvents(data);
      } catch {
        if (!controller.signal.aborted) {
          setError("Unable to load audit history. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [open, filingId, attempt]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setLoading(true);
      setError(null);
    }
    if (!nextOpen) { setEditing(null); setSaveError(null); }
    setOpen(nextOpen);
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="right">
      {children}
      <DrawerContent aria-describedby={undefined}>
        <DrawerTitle render={<h1 />} className="flex min-w-0 items-start gap-2 px-5 py-4 pr-14 text-2xl leading-tight font-bold tracking-tight">
          <span className="min-w-0 [overflow-wrap:anywhere]">{filing.title}</span>
          {canEdit && <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Edit title" disabled={saving} onClick={() => {
            setEditing("title");
            setValue(filing.title);
            setSaveError(null);
          }}>
            <PenBox className="size-4 text-muted-foreground"/>
          </Button>}
        </DrawerTitle>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {editing === "title" && (
            <form onSubmit={save} className="mb-6 space-y-2">
              <label htmlFor={`filing-title-${filing.id}`} className="text-xs text-muted-foreground">Title</label>
              <Input id={`filing-title-${filing.id}`} value={editValue} onChange={(event) => setValue(event.target.value)} maxLength={255} required disabled={saving} autoFocus />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving || !editValue.trim()}>{saving ? "Saving…" : "Save"}</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(null); setSaveError(null); }}>Cancel</Button>
              </div>
              {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            </form>
          )}
          <dl className="mb-6 space-y-3">
            {[
              ["Category", filing.category],
              ["Status", filing.status?.replaceAll("_", " ") ?? "—"],
              ["Expiration date", filing.expirationDate
                ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }).format(new Date(filing.expirationDate))
                : "—"],
              ["Version", filing.version],
              ["ID", filing.id],
              ["Tenant ID", filing.tenantId],
              ["Created by", filing.createdBy ?? "—"],
              ["Created at", formatTimestamp(filing.createdAt)],
              ["Updated at", formatTimestamp(filing.updatedAt)],
            ].map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words text-sm">
                  {editing && ((label === "Category" && editing === "category") || (label === "Expiration date" && editing === "expirationDate")) ? (
                    <form onSubmit={save} className="space-y-2">
                      <Input
                        aria-label={String(label)}
                        type={editing === "expirationDate" ? "date" : "text"}
                        value={editValue}
                        onChange={(event) => setValue(event.target.value)}
                        maxLength={editing === "category" ? 50 : undefined}
                        required
                        disabled={saving}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={saving || !editValue.trim()}>{saving ? "Saving…" : "Save"}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(null); setSaveError(null); }}>Cancel</Button>
                      </div>
                      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
                    </form>
                  ) : (
                    <span className="flex items-center gap-1">
                      {value}
                      {canEdit && (label === "Category" || label === "Expiration date") && (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${String(label).toLowerCase()}`} disabled={saving} onClick={() => {
                          const field = label === "Category" ? "category" : "expirationDate";
                          setEditing(field);
                          setValue(field === "category" ? filing.category : filing.expirationDate?.slice(0, 10) ?? "");
                          setSaveError(null);
                        }}><PenBox className="size-4 text-muted-foreground" /></Button>
                      )}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <h2 className="mb-3 text-lg font-semibold">Audit history</h2>
          <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <Trace>
              <TraceLine status="running">
                <TraceIcon><LoaderCircle className="animate-spin motion-reduce:animate-none" /></TraceIcon>
                <TraceTitle>Loading audit history…</TraceTitle>
              </TraceLine>
            </Trace>
          ) : error ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit history yet.</p>
          ) : (
            <Trace role="list" aria-label="Audit events" className="gap-4">
              {events.map((event) => (
                <TraceCollapsible key={event.id} role="listitem">
                  <TraceCollapsibleTrigger>
                    <TraceLine className="items-start">
                      <TraceIcon className="mt-0.5"><FileClock /></TraceIcon>
                      <TraceTitle className="whitespace-normal font-medium text-foreground">
                        {event.action.replaceAll("_", " ")}
                      </TraceTitle>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  {event.timestamp && (
                    <TraceDescription className="ml-6 mt-1 text-xs">
                      <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
                    </TraceDescription>
                  )}
                  <TraceCollapsibleContent className="space-y-2 text-sm">
                    <p>{event.previousState ?? "—"} → {event.newState ?? "—"}</p>
                    <p className="break-all">Actor: {event.actorId}</p>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              ))}
            </Trace>
          )}
          </div>
        </div>
        <DrawerClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
          aria-label="Close drawer"
        >
          <X aria-hidden="true" />
        </DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}
