import { useId, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
};

export function FormField({ label, error, hint, id, className = "", ...props }: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const detailId = `${fieldId}-detail`;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? detailId : undefined}
        {...props}
      />
      {error || hint ? (
        <span id={detailId} className={error ? "field__error" : "field__hint"}>
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: React.ReactNode;
};

export function SelectField({ label, children, id, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <select id={fieldId} {...props}>
        {children}
      </select>
    </div>
  );
}
