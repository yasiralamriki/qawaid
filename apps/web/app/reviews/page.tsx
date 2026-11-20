import { redirect } from "next/navigation";

// Preserve old bookmarks; reviews now live in the auditor's Filings view.
export default function Reviews() {
  redirect("/filings");
}
