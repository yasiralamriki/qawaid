"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { FileClock, LoaderCircle, X } from "lucide-react";
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

export function FilingDrawer({
  title,
  filingId,
  children,
}: {
  title: ReactNode;
  filingId: string;
  children: ReactNode;
}) {
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
    setOpen(nextOpen);
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="right">
      {children}
      <DrawerContent aria-describedby={undefined}>
        <DrawerTitle render={<h1 />} className="break-words px-5 py-4 pr-14 text-2xl font-bold tracking-tight">{title}</DrawerTitle>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" aria-live="polite" aria-busy={loading}>
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
