"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ChecklistOption = {
  value: string;
  label: string;
  description?: string;
};

type MultiSelectChecklistProps = {
  label: string;
  options: ChecklistOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
};

export function MultiSelectChecklist({
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = "搜索选项",
  emptyText = "暂无可选项",
  className = "",
}: MultiSelectChecklistProps) {
  const [keyword, setKeyword] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visibleOptions = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) {
      return options;
    }
    return options.filter((option) => {
      return (
        option.value.toLowerCase().includes(text) ||
        option.label.toLowerCase().includes(text) ||
        (option.description ?? "").toLowerCase().includes(text)
      );
    });
  }, [keyword, options]);

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    onChange([...selected, value]);
  };

  const selectedOptions = selected
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is ChecklistOption => Boolean(option));

  return (
    <div className={`space-y-2 rounded-xl border border-slate-200 p-3 ${className}`}>
      <Label>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          className="pl-8"
          placeholder={searchPlaceholder}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="flex min-h-8 flex-wrap gap-1.5">
        {selectedOptions.length === 0 ? (
          <p className="text-xs text-slate-500">尚未选择</p>
        ) : (
          selectedOptions.map((option) => (
            <Badge
              key={option.value}
              variant="secondary"
              className="inline-flex items-center gap-1 rounded-full"
            >
              {option.label}
              <button
                type="button"
                aria-label={`移除 ${option.label}`}
                onClick={() => toggle(option.value)}
                className="rounded-full p-0.5 hover:bg-slate-300/40"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
        {visibleOptions.length === 0 ? (
          <p className="px-1 py-2 text-xs text-slate-500">{emptyText}</p>
        ) : (
          visibleOptions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option.value)}
                onChange={() => toggle(option.value)}
                className="mt-0.5"
              />
              <span className="min-w-0 text-sm text-slate-700">
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="block truncate text-xs text-slate-500">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
