import { useId, useState } from 'react';

/** Password input with a show/hide toggle. `hint` is shown under the field; `error` replaces it and marks the field invalid. */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-d`}
          disabled={disabled}
          required
        />
        <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)} aria-pressed={shown} disabled={disabled}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      <p id={`${id}-d`} className={error ? 'field-error' : 'field-hint'}>
        {error || hint}
      </p>
    </div>
  );
}

/** Mirrors the server rules (server/password.ts) so people see problems before submitting. The server still decides. */
export function passwordHint(p: string): string {
  if (p.length < 8) return 'At least 8 characters, with a letter and a number.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Add at least one letter and one number.';
  return 'Looks good.';
}
