"use client";
import { useRouter } from "next/navigation";
import { Users2 } from "lucide-react";
import { CustomersTab } from "@/components/lab/CustomersTab";
import { useLang } from "@/components/layout/AppShell";

export default function CustomersPage() {
  const { t } = useLang();
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <Users2 size={22} className="text-slate-500" />
          {t("Customers", "الزبائن")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            "One register for the whole plant — orders and quality both hang off these rows.",
            "سجل واحد للمصنع كله — الطلبيات والجودة كلتاهما مبنيّتان على هذه الصفوف."
          )}
        </p>
      </div>

      <CustomersTab onOpen={(id) => router.push(`/customers/${id}`)} />
    </div>
  );
}
