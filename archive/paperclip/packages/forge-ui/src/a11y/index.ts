/**
 * @fora/forge-ui/a11y — accessibility helpers per FORA-393 Plan 3 §5.
 *
 * - LiveRegionProvider / useAnnouncer: WCAG 4.1.3 Status Messages.
 * - SkipLink: WCAG 2.4.1 Bypass Blocks.
 * - VisuallyHidden: keeps content in the a11y tree while hiding visually
 *   (WCAG 1.3.1 Info & Relationships).
 */
export { LiveRegionProvider, useAnnouncer } from "./live-region";
export { SkipLink, type SkipLinkProps } from "./skip-link";
export { VisuallyHidden } from "./visually-hidden";
