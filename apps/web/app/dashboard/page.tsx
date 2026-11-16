import { Card } from "@/components/ui/card";
import { cookies } from "next/headers";

interface CurrentUser {
  id: string;
  username: string;
  tenantId: string | null;
  tenantName: string | null;
  role: "SUBMITTER" | "AUDITOR" | "SYSTEM_ADMIN";
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

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to load your account");
  }

  return response.json();
}

async function fetchCurrentFilings(): Promise<any> {
  const cookieStore = await cookies();
  const response = await fetch(
    new URL("/api/filings", process.env.API_URL ?? "http://localhost:4000"),
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to load your filings");
  }

  return response.json();
}

export default async function Dashboard() {
  const userData = await fetchCurrentUser();
  const filingsData = await fetchCurrentFilings();

  if (userData && userData.role === "SUBMITTER") {
    return (
      <div className="flex flex-col h-full w-full items-top justify-left p-8 gap-6">
        <h1 className="text-2xl font-bold">
          Welcome back, {userData.username}!
        </h1>
        <div className='flex flex-row justify-between gap-6'>
          <Card className='flex-1 justify-center items-center'>
            <h1 className='text-3xl font-bold text-muted-foreground'>0</h1>
            <p className='text-xl text-foreground'>Drafts</p>
          </Card>
          <Card className='flex-1 justify-center items-center'>
            <h1 className='text-3xl font-bold text-yellow-500'>0</h1>
            <p className='text-xl text-foreground'>Submitted</p>
          </Card>
          <Card className='flex-1 justify-center items-center'>
            <h1 className='text-3xl font-bold text-primary'>0</h1>
            <p className='text-xl text-foreground'>Approved</p>
          </Card>
          <Card className='flex-1 justify-center items-center'>
            <h1 className='text-3xl font-bold text-red-500'>0</h1>
            <p className='text-xl text-foreground'>Rejected</p>
          </Card>
        </div>
        <div>
            <Card className='flex-1 justify-center items-center'>
                <h1 className='text-3xl font-bold text-muted-foreground'>Recent filings [PLACEHOLDER]</h1>
            </Card>
        </div>
      </div>
    );
  } else if (userData && userData.role === "AUDITOR") {
    return <div />;
  } else if (userData && userData.role === "SYSTEM_ADMIN") {
    return <div />;
  }
}
