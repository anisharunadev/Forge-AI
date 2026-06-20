import type { JSX } from "react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * LiveRegion — WCAG 4.1.3 Status Messages. Two politeness levels:
 * - `polite`: announces at the next pause (default for non-urgent updates)
 * - `assertive`: announces immediately (use sparingly — only for errors)
 */
type Politeness = "polite" | "assertive";

interface Announcer {
  announce: (message: string, politeness?: Politeness) => void;
}

const AnnouncerContext = createContext<Announcer | null>(null);

export interface LiveRegionProviderProps {
  children: ReactNode;
}

/**
 * LiveRegionProvider renders two visually-hidden ARIA live regions (one per
 * politeness) and exposes an `announce` function via context.
 */
export function LiveRegionProvider({
  children,
}: LiveRegionProviderProps) {
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");

  const announcer = useMemo<Announcer>(
    () => ({
      announce: (message: string, politeness: Politeness = "polite") => {
        if (politeness === "assertive") {
          setAssertiveMessage(message);
        } else {
          setPoliteMessage(message);
        }
      },
    }),
    [],
  );

  return (
    <AnnouncerContext.Provider value={announcer}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-forge-live="polite"
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        data-forge-live="assertive"
      >
        {assertiveMessage}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) {
    throw new Error("useAnnouncer must be used within a LiveRegionProvider");
  }
  return ctx;
}