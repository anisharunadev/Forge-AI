## UI Pro Max Search Results
**Domain:** ux | **Query:** keyboard shortcut command palette focus management
**Source:** ux-guidelines.csv | **Found:** 3 results

### Result 1
- **Category:** Interaction
- **Issue:** Focus States
- **Platform:** All
- **Description:** Keyboard users need visible focus indicators
- **Do:** Use visible focus rings on interactive elements
- **Don't:** Remove focus outline without replacement
- **Code Example Good:** focus:ring-2 focus:ring-blue-500
- **Code Example Bad:** outline-none without alternative
- **Severity:** High

### Result 2
- **Category:** Accessibility
- **Issue:** Keyboard Navigation
- **Platform:** Web
- **Description:** All functionality accessible via keyboard
- **Do:** Tab order matches visual order
- **Don't:** Keyboard traps or illogical tab order
- **Code Example Good:** tabIndex for custom order
- **Code Example Bad:** Unreachable elements
- **Severity:** High

### Result 3
- **Category:** Layout
- **Issue:** Z-Index Management
- **Platform:** Web
- **Description:** Stacking context conflicts cause hidden elements
- **Do:** Define z-index scale system (10 20 30 50)
- **Don't:** Use arbitrary large z-index values
- **Code Example Good:** z-10 z-20 z-50
- **Code Example Bad:** z-[9999]
- **Severity:** High

