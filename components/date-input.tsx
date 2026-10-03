'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { formatDay, parseDay } from '@/lib/dates';

// A native <input type="date"> shows the browser's own format (mm/dd/yyyy in an English
// browser) and a page can't change that. So the visible field is text in dd.mm.rrrr, typed
// with the dots filled in automatically; the 📅 button opens the browser's calendar through a
// hidden date input. The URL keeps ISO dates (2026-10-02).
const mask = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return (
    digits.slice(0, 2) +
    (digits.length > 2 ? '.' + digits.slice(2, 4) : '') +
    (digits.length > 4 ? '.' + digits.slice(4) : '')
  );
};

export function DateInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: string; // ISO day or ''
  min?: string;
  max?: string;
  onCommit: (day: string) => void;
}) {
  const [text, setText] = useState(formatDay(value));
  const picker = useRef<HTMLInputElement>(null);
  const commit = useEffectEvent(onCommit);

  // follow the URL (presets, back/forward); adjusted while rendering, not in an effect
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(formatDay(value));
  }

  // navigate once the typed text is a real date (or emptied) and typing pauses
  useEffect(() => {
    const iso = text === '' ? '' : parseDay(text);
    if (iso === value || (text !== '' && !iso)) return; // unchanged, or half-typed
    const timer = setTimeout(() => commit(iso), 400);
    return () => clearTimeout(timer);
  }, [text, value]);

  const iso = parseDay(text);
  const invalid = text.length === 10 && !iso;

  return (
    <label className="date-field">
      <span>{label}</span>
      <span className={`date-box${invalid ? ' invalid' : ''}`}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd.mm.rrrr"
          aria-label={`${label} (dd.mm.yyyy)`}
          aria-invalid={invalid || undefined}
          maxLength={10}
          value={text}
          onChange={(event) => setText(mask(event.target.value))}
        />
        <button
          type="button"
          className="cal"
          aria-label={`Pick the ${label.toLowerCase()} date`}
          onClick={() => {
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus(); // older browsers: focusing the input opens its picker
            }
          }}
        >
          📅
        </button>
        <input
          ref={picker}
          type="date"
          className="picker"
          tabIndex={-1}
          aria-hidden="true"
          value={iso || value}
          min={min}
          max={max}
          onChange={(event) => setText(formatDay(event.target.value))}
        />
      </span>
    </label>
  );
}
