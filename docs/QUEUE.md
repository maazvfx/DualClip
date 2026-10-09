# DualClip — Task Intake, Triage & Verification Queue

> **Rule**: When queuing tasks or user reports, add them to §1. 
> **Never modify code for a reported bug without verifying it first against source/tests.**
> Once verified as a real bug, promote to `docs/STATE.md`. If invalid/expected behavior, move to §3.

---

## 1. Inbox (Unverified Tasks & Reports)
<!-- Verified and promoted below -->

---

## 2. Triaged & Validated (Promoted to Execution)

- [x] **[UI/Sidebar] Remove hover badge numbers in Side View**:
  - *Reported Behavior*: Numbers show up on hover in the side view items.
  - *Expected Behavior*: Remove the count badge display on hover entirely so side view is clean.
  - *Repro / Code Site*: `ui/css/sidebar-layout.css` (`.sidebar-nav-badge`, `.sidebar-nav-item:hover .sidebar-nav-badge`).
  - *Status*: Done — `.sidebar-nav-badge { display: none !important; }` shipped; pinned by `UiStaticInvariantTests.SidebarBadges_HiddenByCss`.

- [x] **[UI/List] Remove count badges from group headers (Today, Yesterday, Older, etc.)**:
  - *Reported Behavior*: Group headers display count badges (e.g. `12`, `5+`).
  - *Expected Behavior*: Remove the number badge from the group headers.
  - *Repro / Code Site*: `ui/css/clip-list.css` (`.group-count { display: none; }`).
  - *Status*: Done — `.group-count { display: none !important; }` shipped; pinned by `UiStaticInvariantTests.GroupCountBadges_HiddenByCss`.

- [x] **[UI/Menu] Scale down context menu size in Compact mode**:
  - *Reported Behavior*: Right-click context menu is oversized in compact window mode (360x260).
  - *Expected Behavior*: Context menu should scale down smoothly in compact mode with tighter padding, smaller font, and compact bounds.
  - *Repro / Code Site*: `ui/css/collections-bar.css` (`html[data-layout-preset="compact"] .context-menu`, `html[data-layout-preset="compact"] .menu-item`).
  - *Status*: Done — compact scaling rules shipped; pinned by `UiStaticInvariantTests.CompactMenu_HasCompactScalingRules` + harness `compact_menu_never_exceeds_viewport`.

---

## 3. False Flags & Expected Behaviors (Closed / Knowledge Log)
<!-- Items proven to be expected behavior, OS quirks, or user-side configuration.
Prevents future agents from re-attempting unnecessary fixes. Record 1-line reason + proof. -->

