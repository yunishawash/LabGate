"use client";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/layout/AppShell";
import type { ComboboxOption } from "@/components/ui/combobox";

/**
 * `Combobox`'s multi-select sibling — same Popover/Command/cmdk shell, styled
 * identically, but selecting an item toggles it and keeps the list open
 * instead of closing on the first pick.
 */
export function MultiCombobox({
  values, onChange, options, placeholder, searchPlaceholder, emptyText,
  className, triggerClassName, disabled, id,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const selected = new Set(values);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(Array.from(next));
  };

  const label = (() => {
    if (!values.length) return placeholder ?? t("Select…", "اختر…");
    if (values.length === 1) {
      return options.find((o) => o.value === values[0])?.label ?? placeholder ?? t("Select…", "اختر…");
    }
    return t(`${values.length} selected`, `${values.length} محدَّد`);
  })();

  /**
   * `modal` on the Popover below is load-bearing — do not remove it as
   * redundant.
   *
   * The popover is portalled to `document.body`. When it opens inside a
   * Dialog, `@radix-ui/react-dialog` has wrapped the overlay in `RemoveScroll`
   * with `shards: [contentRef]`, and that lock cancels the wheel for any
   * target that is neither inside the lock nor inside a shard. The portalled
   * list is in neither, so `preventDefault()` ran on every wheel event and the
   * dropdown would not scroll with a mouse — while keyboard nav and a
   * programmatic `scrollTop` both worked, which is what made it look like a
   * styling problem rather than a scroll-lock one.
   *
   * `modal` gives the popover its own `RemoveScroll`, which registers the
   * event as handled-and-allowed before the dialog's lock sees it.
   *
   * Verified both ways: the wheel scrolls, and nesting the two locks does not
   * leave the dialog dead afterwards — typing, adding a line, opening a second
   * dropdown and closing everything all still work, on a page as well as
   * inside a dialog.
   */
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700",
            "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            className, triggerClassName
          )}
        >
          <span className={cn("truncate text-start", !values.length && "text-slate-400")}>{label}</span>
          <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-48 p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder ?? t("Search…", "بحث…")} />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-slate-400">
              {emptyText ?? t("No results.", "لا توجد نتائج.")}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.hint ? `${o.label} ${o.hint}` : o.label}
                  onSelect={() => toggle(o.value)}
                  className="cursor-pointer flex items-center gap-2"
                >
                  <Check
                    size={14}
                    className={cn("flex-shrink-0", selected.has(o.value) ? "opacity-100 text-sky-600" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-slate-400">{o.hint}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
