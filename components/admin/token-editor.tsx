"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TokenEditorProps = {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
};

export function TokenEditor({
  label,
  value,
  onChange,
  placeholder = "输入后点击添加",
  suggestions = [],
}: TokenEditorProps) {
  const [draft, setDraft] = useState("");

  const addToken = (raw: string) => {
    const token = raw.trim();
    if (!token || value.includes(token)) {
      return;
    }
    onChange([...value, token]);
    setDraft("");
  };

  const removeToken = (token: string) => {
    onChange(value.filter((item) => item !== token));
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addToken(draft);
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => addToken(draft)}>
          <Plus className="h-4 w-4" />
          添加
        </Button>
      </div>

      <div className="flex min-h-8 flex-wrap gap-1.5">
        {value.length === 0 ? (
          <p className="text-xs text-slate-500">暂无条目</p>
        ) : (
          value.map((token) => (
            <Badge
              key={token}
              variant="secondary"
              className="inline-flex items-center gap-1 rounded-full"
            >
              {token}
              <button
                type="button"
                aria-label={`移除 ${token}`}
                onClick={() => removeToken(token)}
                className="rounded-full p-0.5 hover:bg-slate-300/40"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => addToken(option)}
              className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              + {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
