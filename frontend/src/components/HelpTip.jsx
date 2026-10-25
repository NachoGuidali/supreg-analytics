import { useEffect, useId, useRef, useState } from "react";

/** Ayuda contextual: un (?) que explica una métrica o un control. Se abre con click o teclado. */
export default function HelpTip({ children, label = "Qué es esto" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="grid h-[18px] w-[18px] place-items-center rounded-full border border-line text-[11px] font-semibold text-muted hover:border-accent hover:text-accent"
      >
        ?
      </button>
      {open && (
        <span id={id} role="note" className="animate-pop absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-left text-[13px] font-normal leading-relaxed text-ink-2 shadow-xl">
          {children}
        </span>
      )}
    </span>
  );
}
