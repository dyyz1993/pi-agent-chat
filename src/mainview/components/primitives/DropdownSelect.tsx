import { Check, ChevronDown } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/classes";
import { AnchoredPopover } from "./AnchoredPopover";

export interface DropdownSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
}

export interface DropdownSelectProps {
  value: string;
  options: DropdownSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  optionClassName?: string;
  ariaLabel?: string;
  emptyLabel?: string;
}

export function DropdownSelect({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  className,
  menuClassName,
  optionClassName,
  ariaLabel,
  emptyLabel = "No options",
}: DropdownSelectProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);

  const commitValue = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      setOpen(false);
      buttonRef.current?.focus();
    },
    [onChange],
  );

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (enabledOptions.length === 0) return;
      const currentIndex = enabledOptions.findIndex((option) => option.value === value);
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : enabledOptions.length - 1
          : (currentIndex + direction + enabledOptions.length) % enabledOptions.length;
      commitValue(enabledOptions[nextIndex].value);
    },
    [commitValue, enabledOptions, value],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) moveSelection(1);
      else setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) moveSelection(-1);
      else setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className={cx(
          "inline-flex min-w-0 items-center justify-between gap-2 rounded-md border border-border-secondary bg-bg-elevated px-2 py-1 text-left text-xs text-text-secondary outline-none transition-colors hover:bg-surface-hover focus:border-border-focus disabled:cursor-wait disabled:opacity-60 dark:bg-surface-code",
          className,
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      <AnchoredPopover
        anchorRef={buttonRef}
        open={open}
        onClose={() => setOpen(false)}
        align="stretch"
        maxHeight={260}
        className={cx(
          "rounded-md border border-border-secondary bg-bg-elevated shadow-xl dark:bg-surface-dim overflow-hidden flex flex-col",
          menuClassName,
        )}
      >
        <div id={id} role="listbox" aria-label={ariaLabel} className="space-y-0.5 overflow-y-auto overflow-x-hidden flex-1 min-h-0 p-1">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-tertiary">{emptyLabel}</div>
          ) : (
            options.map((option) => {
              const showGroup = option.group && option.group !== lastGroup;
              lastGroup = option.group;
              const selectedOption = option.value === value;
              return (
                <div key={option.value}>
                  {showGroup && (
                    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-normal text-text-tertiary">
                      {option.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedOption}
                    disabled={option.disabled}
                    onClick={() => commitValue(option.value)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50",
                      selectedOption && "bg-semantic-accent/10 text-text-primary",
                      optionClassName,
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-[10px] text-text-tertiary">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {selectedOption && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-semantic-accent" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </AnchoredPopover>
    </>
  );
}
