import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hand the session down so the client shell renders correctly on first paint
  // instead of flashing a signed-out sidebar.
  const session = await auth();
  return <AppShell initialSession={session}>{children}</AppShell>;
}
