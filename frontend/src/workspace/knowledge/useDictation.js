import { useEffect, useRef, useState } from "react";

export function useDictation(onText, language) {
  const callback = useRef(onText);
  callback.current = onText;
  const recognizer = useRef(null);
  const [status, setStatus] = useState("idle");
  const Constructor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  useEffect(() => () => {
    if (recognizer.current) {
      recognizer.current.onend = null;
      recognizer.current.onerror = null;
      recognizer.current.onresult = null;
      recognizer.current.abort();
    }
  }, []);
  function start() {
    if (!Constructor || recognizer.current) return;
    const recognition = new Constructor();
    recognition.lang = language === "ar" ? "ar-LY" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) callback.current(event.results[index][0].transcript);
      }
    };
    recognition.onerror = (event) => setStatus(event.error === "not-allowed" ? "permission" : "error");
    recognition.onend = () => {
      recognizer.current = null;
      setStatus((previous) => previous === "listening" ? "idle" : previous);
    };
    recognizer.current = recognition;
    setStatus("listening");
    try { recognition.start(); }
    catch { recognizer.current = null; setStatus("error"); }
  }
  return { supported: Boolean(Constructor), status,
    toggle: () => recognizer.current ? recognizer.current.stop() : start() };
}
