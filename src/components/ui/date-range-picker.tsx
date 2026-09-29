"use client";
import { useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, isAfter,
} from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/components/layout/AppShell";
import { formatDate, toDateInputValue } from "@/lib/utils";

/** `yyyy-mm-dd` — the same shape `<input type="date">` already produced —
 *  parsed as a plain LOCAL calendar date (never a UTC instant): a picker's
 *  whole job is choosing days on a visible grid, not instants, so this must
 *  read back exactly the day that was clicked regardless of the browser's
 *  own UTC offset. */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function monthGrid(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  return eachDayOfInterval({ start, end });
}

/**
 * A calendar-grid range picker replacing two bare `<input type="date">`
 * fields. `from`/`to` and `onChange` all speak the same `yyyy-mm-dd` strings
 * the two inputs used, so callers swap the widget without touching their own
 * state shape or the querystring they build from it.
 */
export function DateRangePicker({
  from, to, onChange,
}: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  const [viewMonth, setViewMonth] = useState(() => toDate ?? fromDate ?? new Date());
  const [hover, setHover] = useState<Date | null>(null);

  const weekdayFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { weekday: "narrow" });
  const monthFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    month: "long", year: "numeric", numberingSystem: "latn",
  });
  const weekdayLabels = eachDayOfInterval({
    start: startOfWeek(new Date()), end: endOfWeek(new Date()),
  }).map((d) => weekdayFmt.format(d));

  const pick = (day: Date) => {
    // A complete range (or none yet) starts a fresh selection; a half-open
    // range (`from` set, `to` not) closes it — swapping if the second click
    // landed before the first, so click order never matters to the caller.
    if (!fromDate || (fromDate && toDate)) {
      onChange(toDateInputValue(day), "");
      return;
    }
    const [lo, hi] = isAfter(fromDate, day) ? [day, fromDate] : [fromDate, day];
    onChange(toDateInputValue(lo), toDateInputValue(hi));
    setOpen(false);
  };

  const preset = (lo: Date, hi: Date) => {
    onChange(toDateInputValue(lo), toDateInputValue(hi));
    setViewMonth(hi);
    setOpen(false);
  };

  const today = new Date();
  const PRESETS: { label: string; range: () => [Date, Date] }[] = [
    { label: t("Today", "اليوم"), range: () => [today, today] },
    { label: t("Last 7 days", "آخر 7 أيام"), range: () => [addDays(today, -6), today] },
    { label: t("This month", "هذا الشهر"), range: () => [startOfMonth(today), today] },
    { label: t("Last 30 days", "آخر 30 يومًا"), range: () => [addDays(today, -29), today] },
  ];

  const label = fromDate
    ? `${formatDate(fromDate)}${toDate ? ` – ${formatDate(toDate)}` : ""}`
    : t("All dates", "كل التواريخ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-2 whitespace-nowrap"
          >
            <CalendarIcon size={14} className="text-slate-400" />
            <bdi>{label}</bdi>
          </button>
        </PopoverTrigger>
        {(from || to) && (
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="h-9 px-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 cursor-pointer flex items-center"
            aria-label={t("Clear dates", "مسح التواريخ")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 pe-3 border-e border-slate-100 min-w-28">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const [lo, hi] = p.range();
                  preset(lo, hi);
                }}
                className="text-start text-xs px-2 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="w-64">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth((m) => subMonths(m, 1))}
                className="h-7 w-7 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer rtl:rotate-180"
                aria-label={t("Previous month", "الشهر السابق")}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-sm font-medium text-slate-800">{monthFmt.format(viewMonth)}</span>
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
                className="h-7 w-7 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer rtl:rotate-180"
                aria-label={t("Next month", "الشهر التالي")}
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {weekdayLabels.map((w, i) => (
                <span key={i} className="text-[11px] text-slate-400 h-6 grid place-items-center">{w}</span>
              ))}
              {monthGrid(viewMonth).map((day) => {
                const inMonth = isSameMonth(day, viewMonth);
                const isFrom = fromDate && isSameDay(day, fromDate);
                const isTo = toDate && isSameDay(day, toDate);
                const rangeEnd = toDate ?? (fromDate && hover ? hover : null);
                const inRange =
                  fromDate && rangeEnd &&
                  isWithinInterval(day, {
                    start: isAfter(fromDate, rangeEnd) ? rangeEnd : fromDate,
                    end: isAfter(fromDate, rangeEnd) ? fromDate : rangeEnd,
                  });
                const isEndpoint = isFrom || isTo;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={!inMonth}
                    onMouseEnter={() => setHover(day)}
                    onClick={() => pick(day)}
                    className={
                      "h-8 text-xs rounded-md tabular-nums " +
                      (!inMonth
                        ? "text-transparent pointer-events-none"
                        : isEndpoint
                          ? "bg-sky-600 text-white font-medium"
                          : inRange
                            ? "bg-sky-50 text-sky-700"
                            : isSameDay(day, today)
                              ? "text-sky-700 font-medium hover:bg-slate-100"
                              : "text-slate-700 hover:bg-slate-100 cursor-pointer")
                    }
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
