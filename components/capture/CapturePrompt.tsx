import { useRef, useState, useEffect } from "react";

interface CapturePromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function CapturePrompt({ value, onChange, onSubmit }: CapturePromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [value]);

  const canSubmit = value.trim().length > 0;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  return (
    <div
      className={`relative rounded-2xl bg-gradient-to-br from-background/80 to-background/60 backdrop-blur-xl border transition-all duration-200 ${
        isDragging
          ? "border-primary/50 bg-primary/5"
          : isFocused
          ? "border-primary/30"
          : "border-border"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-2xl z-10">
          <div className="text-center">
            <svg
              className="mx-auto h-8 w-8 text-primary mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm font-medium text-primary">Drop files here</p>
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder="Paid using UOB One Visa. Thailand holiday. Need reimbursement."
        className="w-full bg-transparent px-5 py-4 pr-12 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/50 resize-none outline-none min-h-[100px] max-h-[400px]"
        rows={1}
      />
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className={`absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
          canSubmit
            ? "bg-primary text-primary-foreground hover:scale-102"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        }`}
        aria-label="Submit"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14 5l7 7m0 0l-7 7m7-7H3"
          />
        </svg>
      </button>
    </div>
  );
}
