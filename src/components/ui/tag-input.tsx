"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TagInputProps {
  tags: string[];
  placeholder: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}

export function TagInput({ tags, placeholder, onAdd, onRemove }: TagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const val = input.trim();
    if (!val) return;
    onAdd(val);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onRemove(tags.length - 1);
    }
  }

  return (
    <div
      className="min-h-9 flex flex-wrap items-center gap-1.5 rounded-xl glass-input px-2 py-1.5 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded bg-accent/40 backdrop-blur-sm px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(i); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="h-auto flex-1 min-w-24 border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
