import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

/** Confirmaciones breves de una acción ("Cliente creado"). Se anuncian a lectores de pantalla. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const toast = useCallback((text, { tone = "default" } = {}) => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-toast pointer-events-auto flex items-center gap-2.5 rounded-xl bg-rail px-4 py-2.5 text-sm text-rail-ink shadow-2xl ${t.tone === "error" ? "ring-1 ring-bad" : ""}`}
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${t.tone === "error" ? "bg-bad" : "bg-accent-on-dark"}`} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
