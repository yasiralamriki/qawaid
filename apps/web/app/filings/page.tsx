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

interface CurrentUser {
  id: string;
  username: string;
  tenantId: string | null;
  tenantName: string | null;
  role: "SUBMITTER" | "AUDITOR" | "SYSTEM_ADMIN";
}

interface Filing {
  id: string;
  title: string;
  category: string;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | null;
  createdAt: string | null;
  updatedAt: string | null;
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

async function createFiling(formData: FormData, submitForReview: boolean) {
  const title = formData.get("title");
  const category = formData.get("category");

  if (
    typeof title !== "string" || !title.trim() || title.trim().length > 255 ||
    typeof category !== "string" || !category.trim() || category.trim().length > 50
  ) {
    throw new Error("A valid title and category are required.");
  }

  const cookieStore = await cookies();
  const response = await fetch(
    new URL(
      submitForReview ? "/api/filings/submit-new" : "/api/filings",
      process.env.API_URL ?? "http://localhost:4000",
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieStore.toString(),
      },
      body: JSON.stringify({ title: title.trim(), category: category.trim() }),
      cache: "no-store",
    },
  );

  if (response.status === 401) redirect("/login");
  if (response.status === 403) throw new Error("Your account cannot create filings.");
  if (!response.ok) throw new Error("Unable to save the filing. Please try again.");

  revalidatePath("/filings");
  redirect("/filings");
}

async function submitDraft(formData: FormData) {
  "use server";
  await createFiling(formData, false);
}

async function submitForReview(formData: FormData) {
  "use server";
  await createFiling(formData, true);
}

async function FilingsContent() {
  const userData = await fetchCurrentUser();
  if (!userData) redirect("/login");

  const filingsData = await fetchCurrentFilings();
  const title =
    userData.role === "SUBMITTER"
      ? "My Filings"
      : userData.role === "AUDITOR"
        ? "Company Filings"
        : "All Filings";

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
        {userData.role === "SUBMITTER" && <Dialog>
            <DialogTrigger
              render={
                <Button type="button" className="w-full gap-2 shadow-sm sm:w-auto">
                <Plus className="size-4" aria-hidden="true" />
                New Filing
                </Button>
              }
            />
            <DialogContent className="sm:max-w-sm">
              <form action={submitDraft} className="space-y-6">
              <DialogHeader>
                <DialogTitle>New Filing</DialogTitle>
                <DialogDescription>
                  Create a new filing to submit for review and compliance
                  approval.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <Label htmlFor="title-1">Title</Label>
                  <Input id="title-1" name="title" placeholder="Warehouse License Renewal" maxLength={255} required />
                </Field>
                <Field>
                  <Label htmlFor="category-1">Category</Label>
                  <Input
                    id="category-1"
                    name="category"
                    placeholder="License Renewal"
                    maxLength={50}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="expirationdate-1">Expiration Date</Label>
                  <Input
                    id="expirationdate-1"
                    name="expirationdate"
                    type="date"
                    defaultValue="2023-12-31"
                  />
                </Field>
              </FieldGroup>
              <FieldGroup>
                <Field>
                  <Label htmlFor="companyname-1">Company Name</Label>
                  <Input
                    id="companyname-1"
                    name="companyname"
                    defaultValue="Aram Organics"
                  />
                </Field>
                <Field>
                  <Label htmlFor="companyregistrationnumber-1">Company Registration Number</Label>
                  <Input
                    id="companyregistrationnumber-1"
                    name="companyregistrationnumber"
                    defaultValue="123456789"
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit" variant="secondary">
                  Save Draft
                </Button>
                <Button type="submit" formAction={submitForReview}>
                  Submit for Review
                </Button>
              </DialogFooter>
              </form>
            </DialogContent>
        </Dialog>}
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
        <Table aria-label={title}>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent [&>th]:h-11 [&>th]:text-xs [&>th]:font-medium [&>th]:text-muted-foreground">
              <TableHead className="w-[30%] pl-5 sm:pl-6">Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="pr-5 sm:pr-6">Reviewer ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filingsData.length > 0 ? (
              filingsData.map((filing) => (
                <TableRow
                  key={filing.id}
                  className="transition-colors hover:bg-primary/[0.03] [&>td]:py-4"
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
                    {formatDate(filing.createdAt)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(filing.updatedAt)}
                  </TableCell>
                  <TableCell className="pr-5 text-xs text-muted-foreground sm:pr-6">
                    <span
                      className={filing.assignedReviewerId ? "font-mono" : ""}
                    >
                      {filing.assignedReviewerId ?? "Unassigned"}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-72 px-6 text-center">
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

export default function Filings() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-sm text-muted-foreground">
          Loading filings…
        </p>
      }
    >
      <FilingsContent />
    </Suspense>
  );
}
