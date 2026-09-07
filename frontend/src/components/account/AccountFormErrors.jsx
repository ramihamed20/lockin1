export function fieldMessages(error, field) {
  if (!error || !error.fields || !Array.isArray(error.fields[field])) return [];
  return error.fields[field].filter((message) => typeof message === "string" && message);
}

export function fieldErrorAttributes(error, field, errorId, describedBy = "") {
  const invalid = fieldMessages(error, field).length > 0;
  const ids = [describedBy, invalid ? errorId : ""].filter(Boolean).join(" ");
  return {
    "aria-invalid": invalid || undefined,
    "aria-describedby": ids || undefined
  };
}

export function AccountFieldErrors({ error, field = "", id = undefined }) {
  const messages = fieldMessages(error, field);
  if (!messages.length) return null;
  return (
    <p className="form-hint danger" id={id} role="alert">
      {messages.join(" ")}
    </p>
  );
}

export function AccountFormAlert({ error = null, message = "" }) {
  if (error) {
    const fieldValues = Object.values(error.fields || {}).flat().filter((value) => typeof value === "string");
    if (!fieldValues.includes(error.message)) return <p className="form-alert error" role="alert">{error.message}</p>;
    return null;
  }
  return message ? <p className="form-alert success" role="status">{message}</p> : null;
}
