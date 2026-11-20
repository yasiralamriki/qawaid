"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const filingSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  category: z.string().trim().min(1, "License category is required").max(50),
  identifierCr: z.string().trim().min(1, "Company registration is required").max(20),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid date"),
});
type FilingInput = z.infer<typeof filingSchema>;

export function FilingForm({ tenantName, identifierCr }: { tenantName: string; identifierCr: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<"draft" | "review">("draft");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FilingInput>({
    resolver: zodResolver(filingSchema),
    defaultValues: { title: "", category: "", expirationDate: "", identifierCr },
  });
  async function save(values: FilingInput) {
    setError(null);
    try {
      const response = await fetch(intent === "review" ? "/api/filings/submit-new" : "/api/filings", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(response.status === 401 ? "Your session expired. Sign in again." : body?.message ?? "Unable to save filing");
      }
      reset(); setOpen(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect. Your entries have been kept."); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button>New Filing</Button>} />
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
      <DialogHeader><DialogTitle>New Filing</DialogTitle><DialogDescription>Prepare a draft or submit it for review.</DialogDescription></DialogHeader>
      <form onSubmit={handleSubmit(save)} className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2"><Label htmlFor="new-title">Title</Label><Input id="new-title" {...register("title")} aria-invalid={!!errors.title} aria-describedby="title-error" /><p id="title-error" className="text-xs text-destructive">{errors.title?.message}</p></div>
        <div className="space-y-2"><Label htmlFor="new-category">License category</Label><Input id="new-category" {...register("category")} aria-invalid={!!errors.category} aria-describedby="category-error" /><p id="category-error" className="text-xs text-destructive">{errors.category?.message}</p></div>
        <div className="space-y-2"><Label htmlFor="new-expiration">Expiration date</Label><Input id="new-expiration" type="date" {...register("expirationDate")} aria-invalid={!!errors.expirationDate} aria-describedby="expiration-error" /><p id="expiration-error" className="text-xs text-destructive">{errors.expirationDate?.message}</p></div>
        <div className="space-y-2"><Label htmlFor="new-company">Company</Label><Input id="new-company" value={tenantName} readOnly /></div>
        <div className="space-y-2"><Label htmlFor="new-cr">Company registration</Label><Input id="new-cr" {...register("identifierCr")} readOnly aria-describedby="cr-error" /><p id="cr-error" className="text-xs text-destructive">{errors.identifierCr?.message}</p></div>
        <div className="flex justify-end gap-2"><Button type="submit" variant="secondary" disabled={isSubmitting} onClick={() => { setIntent("draft"); }}>{isSubmitting ? "Saving…" : "Save Draft"}</Button><Button type="submit" disabled={isSubmitting} onClick={() => { setIntent("review"); }}>Submit for Review</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
