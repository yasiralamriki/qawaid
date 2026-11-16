"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Button } from "@/ui/button";
import { BuildingComplex, FileText, Gavel, LayoutDashboard, Logs, Stamp } from "lucide-react"
import Link from "next/link";

interface MenuSidebarProps {
  tenantName: string;
  tenantRole: string;
}

export function MenuSidebar({ tenantName, tenantRole }: MenuSidebarProps) {

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
          <Link href='/reviews' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <Gavel />Review Queue
            </Button>
          </Link>
          <Link href='/audit-history' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <Logs  />Audit History
            </Button>
          </Link>
          <Link href='/registry-verifications' className="w-full">
            <Button variant='ghost' className="w-full justify-start">
              <Stamp />Registry Verifications
            </Button>
          </Link>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  )
}
