export function fieldMessages(error, field) {
  if (!error || !error.fields || !Array.isArray(error.fields[field])) return [];
  return error.fields[field].filter((message) => typeof message === "string" && message);
}

export function AccountFieldErrors({ error, field }) {
  const messages = fieldMessages(error, field);
  if (!messages.length) return null;
  return (
    <p className="form-hint danger" role="alert">
      {messages.join(" ")}
    </p>
  );
}

export function AccountFormAlert({ error, message }) {
  if (error) return <p className="form-alert error" role="alert">{error.message}</p>;
  return message ? <p className="form-alert success" role="status">{message}</p> : null;
}
