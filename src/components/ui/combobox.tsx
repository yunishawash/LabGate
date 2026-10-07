"use client";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/layout/AppShell";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line — e.g. an email under a name, a code under a
   *  customer. Shown smaller, under the label, and included in the search. */
  hint?: string;
  /**
   * Optional heading this option sits under — e.g. a product type over its
   * grades. Options carrying the same `group` are rendered together under one
   * heading, in the order they first appear; ungrouped options stay in a
   * leading, headingless group.
   *
   * Searched alongside the label, so typing "طحين" finds every grade of it
   * even though no grade is called that — which is the whole reason a person
   * reaches for a heading in the first place.
   */
  group?: string;
}

/**
 * A searchable dropdown, styled to sit wherever a plain `<select>` used to.
 *
 * Built on the `command`/`popover` primitives that were already in the repo
 * (shadcn-generated, never wired up) rather than a new dependency — `cmdk`
 * gives keyboard nav (↑/↓/Enter/Esc) and the filtering for free.
 *
 * Search matches on `label` (and `hint`, if given) — a person searches for
 * what they SEE ("Al Baraka"), never an internal id — so `CommandItem`'s own
 * `value` is set to that visible text, not `option.value`.
 *
 * The trigger is a `<button role="combobox">`, not a real `<select>`: keeps
 * the exact height/border/focus-ring language of every filter bar and dialog
 * in the app (see `SELECT_CLASS` at each call site) so swapping one in is a
 * drop-in, not a redesign.
 */
export function Combobox({
  value, onChange, options, placeholder, searchPlaceholder, emptyText,
  className, triggerClassName, disabled, id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Extra classes on the trigger — pass the same string you'd have given
   *  the old `<select className={...}>` (e.g. `SELECT_CLASS`, or `h-10 w-full`). */
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  /**
   * Options bucketed by heading, preserving first-appearance order so the
   * caller's own ordering survives. A list with no `group` anywhere collapses
   * to a single headingless bucket, which renders exactly as it always did —
   * every existing call site is untouched by this.
   */
  const groups: [string, ComboboxOption[]][] = [];
  const groupIndex = new Map<string, number>();
  for (const o of options) {
    const key = o.group ?? "";
    let at = groupIndex.get(key);
    if (at === undefined) {
      at = groups.length;
      groupIndex.set(key, at);
      groups.push([key, []]);
    }
    groups[at][1].push(o);
  }

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
          <span className={cn("truncate text-start", !selected && "text-slate-400")}>
            {selected ? selected.label : (placeholder ?? t("Select…", "اختر…"))}
          </span>
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
            {groups.map(([heading, items]) => (
              <CommandGroup key={heading || "__ungrouped"} heading={heading || undefined}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={[o.label, o.hint, o.group].filter(Boolean).join(" ")}
                    onSelect={() => { onChange(o.value); setOpen(false); }}
                    className="cursor-pointer flex items-center gap-2"
                  >
                    <Check
                      size={14}
                      className={cn("flex-shrink-0", o.value === value ? "opacity-100 text-sky-600" : "opacity-0")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-xs text-slate-400">{o.hint}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
