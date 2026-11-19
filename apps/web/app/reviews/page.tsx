import { Suspense } from "react";
import { FileText, Inbox, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DrawerTrigger } from "@/components/ui/drawer";
import { FilingActionsCell } from "@/components/filing-actions-cell";
import { FilingDrawer, type FilingDetails } from "@/components/filing-drawer";

interface CurrentUser {
  id: string;
  username: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantIdentifierCr: string | null;
  role: "SUBMITTER" | "AUDITOR" | "SYSTEM_ADMIN";
}

interface Filing extends FilingDetails {
  assignedReviewerId: string | null;
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/me", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Unable to load your account");

  return response.json();
}

async function fetchCurrentFilings(): Promise<Filing[]> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/filings", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("Unable to load your filings");

  return response.json();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }).format(
    new Date(value),
  );
}

const statusStyles = {
  DRAFT: "border-border bg-muted text-muted-foreground",
  SUBMITTED: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  UNDER_REVIEW:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  APPROVED:
    "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  REJECTED:
    "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const statusLabels = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const formErrors = {
  "invalid-fields": "Enter a valid title, category, and expiration date.",
  forbidden: "Your account cannot create filings.",
  "save-failed": "Unable to save the filing. Please try again.",
  connection: "Unable to connect to the server. Please try again.",
};

type FormErrorCode = keyof typeof formErrors;

type FilingSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

async function ReviewsContent({
  searchParams,
}: {
  searchParams: FilingSearchParams;
}) {
  const params = await searchParams;
  const rawError = params.formError;

  const errorCode =
    typeof rawError === "string" &&
    Object.prototype.hasOwnProperty.call(formErrors, rawError)
      ? (rawError as FormErrorCode)
      : undefined;

  const errorMessage = errorCode ? formErrors[errorCode] : undefined;

  const userData = await fetchCurrentUser();
  if (!userData) redirect("/login");
  if (userData.role !== "AUDITOR") redirect("/dashboard");

  const filingsData = await fetchCurrentFilings();
  const title = 'COmpany Reviews'

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-7 bg-muted/20 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <FileText className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Track submissions, review progress, and compliance decisions.
            </p>
          </div>
        </div>
      </div>
      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold">Recent filings</h2>
            <Badge
              variant="secondary"
              className="h-6 min-w-6 px-2 tabular-nums"
            >
              {filingsData.length}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Latest 50 records
          </span>
        </div>
        <Table aria-label={title} className="min-w-[960px]">
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent [&>th]:h-11 [&>th]:text-xs [&>th]:font-medium [&>th]:text-muted-foreground">
              <TableHead className="w-[28%] min-w-56 pl-5 sm:pl-6">Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32">Expiration date</TableHead>
              <TableHead className="w-28">Created at</TableHead>
              <TableHead className="w-28">Last updated</TableHead>
              <TableHead>Reviewer ID</TableHead>
              <TableHead className="w-28 pr-5 text-right sm:pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filingsData.length > 0 ? (
              filingsData.map((filing) => (
                <FilingDrawer
                  key={filing.id}
                  filing={filing}
                  canEdit={userData.role === "SUBMITTER"}
                >
                <DrawerTrigger
                  nativeButton={false}
                  render={<TableRow />}
                  aria-label={`View filing: ${filing.title}`}
                  className="cursor-pointer transition-colors hover:bg-primary/[0.03] focus-visible:outline-2 focus-visible:outline-ring [&>td]:py-4"
                >
                  <TableCell className="pl-5 font-medium sm:pl-6">
                    <div className="flex items-center gap-3">
                      <FileText
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="max-w-72 truncate" title={filing.title}>
                        {filing.title}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {filing.category}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`h-6 gap-1.5 px-2.5 ${filing.status ? statusStyles[filing.status] : statusStyles.DRAFT}`}
                    >
                      <span
                        className="size-1.5 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {filing.status ? statusLabels[filing.status] : "Unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(filing.expirationDate)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(filing.createdAt)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(filing.updatedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span
                      className={`block max-w-40 truncate ${filing.assignedReviewerId ? "font-mono" : ""}`}
                      title={filing.assignedReviewerId ?? undefined}
                    >
                      {filing.assignedReviewerId ?? "Unassigned"}
                    </span>
                  </TableCell>
                  <FilingActionsCell
                    filingId={filing.id}
                    version={filing.version}
                    isDraft={filing.status === "SUBMITTED" && userData.role === "AUDITOR"}
                  />
                </DrawerTrigger>
                </FilingDrawer>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="h-72 px-6 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 whitespace-normal py-8">
                    <div className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                      <Inbox
                        className="size-6"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </div>
                    <p className="text-sm font-semibold">No filings yet</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Filings available to your account will appear here, along
                      with their status and review details.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <span>
            Showing {filingsData.length}{" "}
            {filingsData.length === 1 ? "filing" : "filings"}
          </span>
          <span>Dates shown in UTC</span>
        </div>
      </Card>
    </div>
  );
}

export default function Reviews({
  searchParams,
}: {
  searchParams: FilingSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-sm text-muted-foreground">
          Loading reviews
        </p>
      }
    >
      <ReviewsContent searchParams={searchParams} />
    </Suspense>
  );
}
