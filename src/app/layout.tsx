import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LabGate — Golden Wheat Mills",
  description: "Sample release workflow — approvals, lab testing and dispatch",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang/dir are set on the client by AppShell once the language is known.
  // Starting at "en"/"ltr" matches the CMMS and avoids a hydration mismatch.
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
