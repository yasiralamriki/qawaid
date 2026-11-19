"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Button } from "@/ui/button";
import { BuildingComplex, FileText, Gavel, LayoutDashboard, LogOut, Stamp, UserRound } from "lucide-react"
import Link from "next/link";
import { useState } from "react";

interface MenuSidebarProps {
  tenantName: string;
  tenantRole: string;
  username: string;
}

export function MenuSidebar({ tenantName, tenantRole, username }: MenuSidebarProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign out failed");
      // Reload the document to discard the authenticated client router cache.
      window.location.replace("/login");
    } catch {
      setSignOutError("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <BuildingComplex className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              {tenantName}
            </h2>
            <p className="truncate text-xs font-medium text-muted-foreground">
              {tenantRole}
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="gap-2">
          <Link href='/dashboard' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <LayoutDashboard />Dashboard
            </Button>
          </Link>
          <Link href='/filings' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <FileText />Filings
            </Button>
          </Link>
          {tenantRole === "AUDITOR" && (
            <Link href='/reviews' className="w-full">
              <Button variant='ghost' className="w-full justify-start">
                <Gavel />Review Queue
              </Button>
            </Link>
          )}
          <Link href='/registry-verifications' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <Stamp />Registry Verifications
            </Button>
          </Link>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 border-t border-sidebar-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
            <UserRound className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={username}>{username}</p>
            <p className="truncate text-xs text-muted-foreground">{tenantRole.replaceAll("_", " ")}</p>
          </div>
        </div>
        {signOutError && <p role="alert" className="text-xs text-destructive">{signOutError}</p>}
        <Button type="button" variant="outline" className="w-full justify-start" onClick={handleSignOut} disabled={signingOut}>
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
