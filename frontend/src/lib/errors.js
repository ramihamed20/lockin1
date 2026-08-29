const HTML_PATTERN = /<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]|<script[\s>]|<style[\s>]/i;
// Runtime error names and stack frames reach `message` whenever a proxy, a
// gateway, or an unhandled server exception answers a request. None of it is
// useful to a reader, and it can name internal hosts and code paths.
const TECHNICAL_PATTERN = /(?:traceback|stack trace|django debug|webpack|vite\/client|\b(?:type|reference|syntax|range|eval|uri|internal|aggregate)error\b|\bat\s+\S+:\d+:\d+)/i;

export function isHtmlErrorMessage(value) {
  return typeof value === "string" && HTML_PATTERN.test(value);
}

export function normalizeUserError(error, fallback = "Something went wrong. Please try again.") {
  const candidate = typeof error === "string"
    ? error
    : typeof error?.message === "string"
      ? error.message
      : "";
  const message = candidate.trim();
  if (!message || isHtmlErrorMessage(message) || TECHNICAL_PATTERN.test(message)) return fallback;
  return message.length > 600 ? fallback : message;
}
