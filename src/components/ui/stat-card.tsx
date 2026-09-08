import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: string;
  color?: "default" | "red" | "yellow" | "green" | "blue";
  className?: string;
  onClick?: () => void;
}

const colorClasses = {
  default: "border-slate-200",
  red: "border-red-200",
  yellow: "border-amber-200",
  green: "border-green-200",
  blue: "border-sky-200",
};

const iconBg = {
  default: "bg-slate-100 text-slate-600",
  red: "bg-red-100 text-red-600",
  yellow: "bg-amber-100 text-amber-600",
  green: "bg-green-100 text-green-600",
  blue: "bg-sky-100 text-sky-600",
};

export function StatCard({
  title,
  value,
  icon,
  trend,
  color = "default",
  className,
  onClick,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-xl border p-5 shadow-sm",
        colorClasses[color],
        onClick && "cursor-pointer hover:shadow-md transition-shadow",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 truncate">
            {value}
          </p>
          {trend && (
            <p className="text-xs text-slate-400 mt-1">{trend}</p>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
              iconBg[color]
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
