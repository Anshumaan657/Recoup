# Phase 7 Accessibility Verification

Phase 7 does not add an automated accessibility dependency. The following bounded checks cover the implemented merchant dashboard:

- Landmarks and structure: the page uses a top-level header, main landmark, labelled sections, a semantic desktop table with a caption, and an ordered audit timeline.
- Keyboard use: native buttons and selects provide keyboard behavior; visible focus rings are defined globally; the case sheet receives focus, traps Tab/Shift+Tab, closes with Escape, and restores the previously focused control.
- Dialog semantics: the case sheet uses `role="dialog"`, `aria-modal="true"`, and an accessible heading. Loading, replay success, and error messages expose status or alert semantics.
- Responsive behavior: the Playwright suite exercises the same workflow at desktop width and exactly 375 px, and asserts that the page has no horizontal overflow.
- Motion: the stylesheet disables non-essential animation and transition duration when `prefers-reduced-motion` is active.
- Contrast: primary body text, muted text, cyan links/accents, header text, and status-pill text/background pairs were checked with the WCAG relative-luminance formula. The lowest checked normal-text pairing is muted `#607587` on `#f7f9fb` at 4.53:1.
- Content safety: model and audit messages render as React text, never HTML. A component test verifies that an HTML-like malicious decision string does not create an element.

Screen-reader behavior should receive a final manual pass with the deployment target during Phase 8 delivery QA.
