import { FilingActionsCell } from "@/components/filing-actions-cell";
import { FilingDrawer, type FilingDetails } from "@/components/filing-drawer";
import { DrawerTrigger } from "@/components/ui/drawer";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Inbox } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

interface CurrentUser {
  id: string;
  username: string;
  tenantId: string | null;
  tenantName: string | null;
  role: "SUBMITTER" | "AUDITOR" | "SYSTEM_ADMIN";
}

interface Filing extends FilingDetails {
  assignedReviewerId: string | null;
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

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/me", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (response.status === 401) {
    redirect("/login");
  }

  if (!response.ok) {
    throw new Error("Unable to load your account");
  }

  return response.json();
}

async function fetchLatestFilings(): Promise<Filing[]> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/filings/?limit=5", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("Unable to load your filings");

  return response.json();
}

async function fetchDashboardStats(): Promise<{
  totalFilings: number;
  draftFilings: number;
  submittedFilings: number;
  approvedFilings: number;
  rejectedFilings: number;
}> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/filings/dashboard-stats", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("Unable to load dashboard stats");

  return response.json();
}

export default async function Dashboard() {
  const userData = await fetchCurrentUser();
  const filingsData = await fetchLatestFilings();
  const dashboardStats = await fetchDashboardStats();

  const title =
    userData && userData.role === "SUBMITTER"
      ? "My Filings"
      : userData && userData.role === "AUDITOR"
        ? "Company Filings"
        : "All Filings";

  return (
    <div className="flex flex-col h-full w-full items-top justify-left p-8 gap-6">
      <h1 className="text-2xl font-bold">Welcome back, {userData && userData.username}!</h1>
      <div className="flex flex-row justify-between gap-6">
        <Card className="flex-1 justify-center items-center">
          <h1 className="text-3xl font-bold text-muted-foreground">{dashboardStats.draftFilings}</h1>
          <p className="text-xl text-foreground">Drafts</p>
        </Card>
        <Card className="flex-1 justify-center items-center">
          <h1 className="text-3xl font-bold text-yellow-500">{dashboardStats.submittedFilings}</h1>
          <p className="text-xl text-foreground">Submitted</p>
        </Card>
        <Card className="flex-1 justify-center items-center">
          <h1 className="text-3xl font-bold text-primary">{dashboardStats.approvedFilings}</h1>
          <p className="text-xl text-foreground">Approved</p>
        </Card>
        <Card className="flex-1 justify-center items-center">
          <h1 className="text-3xl font-bold text-red-500">{dashboardStats.rejectedFilings}</h1>
          <p className="text-xl text-foreground">Rejected</p>
        </Card>
      </div>
      <div>
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
              Latest 5 records
            </span>
          </div>
          <Table aria-label={title} className="min-w-[960px]">
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent [&>th]:h-11 [&>th]:text-xs [&>th]:font-medium [&>th]:text-muted-foreground">
                <TableHead className="w-[30%] pl-5 sm:pl-6">Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expiration date</TableHead>
                <TableHead>Created at</TableHead>
                <TableHead>Last Updated</TableHead>
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
                    canEdit={userData?.role === "SUBMITTER"}
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
                        <span
                          className="max-w-72 truncate"
                          title={filing.title}
                        >
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
                        {filing.status
                          ? statusLabels[filing.status]
                          : "Unknown"}
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
                      status={filing.status}
                    filingId={filing.id}
                      version={filing.version}
                      isDraft={filing.status === "DRAFT" && userData?.role === "SUBMITTER"}
                      isAuditor={userData?.role === "AUDITOR" && filing.status === "SUBMITTED"}
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
                        Filings available to your account will appear here,
                        along with their status and review details.
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
    </div>
  );
}
