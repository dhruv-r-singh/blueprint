"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The dashboard-as-a-page concept is gone — sign-in now takes you straight
// into your most recent project (see app/page.js), and the project switcher
// in the sidebar covers "see my other projects." This route is kept only so
// old bookmarks/links to /dashboard don't 404; it just bounces you to the
// same place sign-in does.
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
