# Problem Report: Radio Configuration Card UI/UX Issues

**Date:** 2025-12-13  
**Severity:** Low (UX/Polish)  
**Status:** RESOLVED  
**Component:** `frontend/src/app/settings/page.tsx` (lines 289-501)  

## Summary

The Radio Configuration card on the Settings page has several UI/UX issues related to the edit mode toggle, icon state management, and conditional rendering logic. While functional, the user experience is confusing because the visual indicators don't always match the expected interaction model.

## Current Implementation

### Component Wiring

```
┌─────────────────────────────────────────────────────────────────┐
│  Radio Configuration Card                                       │
│  ref={radioCardRef}                                             │
├─────────────────────────────────────────────────────────────────┤
│  Header: "Radio Configuration" + Icon Button                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Icon State Machine:                                      │  │
│  │  - !isEditing     → Pencil (edit button)                  │  │
│  │  - isEditing + hasChanges → Green Check (save)            │  │
│  │  - isEditing + !hasChanges → Red X (cancel)               │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  Content: Conditional Render                                    │
│  - isEditing=true  → Form inputs (dropdowns, number inputs)     │
│  - isEditing=false → Read-only display                          │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
radioConfig (from stats.config.radio via Zustand store)
    │
    ├─► Read-only mode: displays formatted values directly
    │
    └─► Edit mode: initializes form state
            │
            formFrequency ──┐
            formBandwidth ──┼─► hasChanges (useMemo comparison)
            formSF ─────────┤         │
            formCR ─────────┤         └─► Determines icon: Check vs X
            formTxPower ────┘
                            │
                            └─► handleSave() → updateRadioConfig API
                                    │
                                    └─► fetchStats() to refresh
```

### Exit Mechanisms

1. **Click outside card** - `handleClickOutside` listener cancels edit
2. **Click X icon** - `cancelEditing()` when no changes
3. **Click Check icon** - `handleSave()` when changes exist (auto-exits after 1.5s on success)
4. **Successful save** - auto-exits edit mode after timeout

## Identified Issues

### Issue 1: Icon State is Confusing

**Problem:** The icon button serves triple duty (edit/save/cancel) based on complex conditional logic. Users may not understand why clicking the icon sometimes saves and sometimes cancels.

**Current Logic:**
```tsx
{isEditing ? (
  hasChanges ? (
    <Check /> // Green - saves
  ) : (
    <X />     // Red - cancels
  )
) : (
  <Pencil /> // Edit
)}
```

**User Confusion:**
- User enters edit mode, makes no changes, sees red X
- Red X typically means "error" or "close", not "exit edit mode"
- When user makes changes, icon changes to green check mid-interaction
- No visual indication of save success until the message appears

**Suggested Fix:** Use persistent icons for edit/cancel with a separate save button:
```
[Pencil]              → Not editing
[X] [Check (greyed)]  → Editing, no changes  
[X] [Check (green)]   → Editing, has changes
```

### Issue 2: No Way to Cancel After Making Changes

**Problem:** Once `hasChanges` is true, the only icon shown is the green check (save). There's no cancel option visible - user must click outside the card.

**User Story:**
1. Click pencil to edit
2. Change frequency value
3. Realize mistake, want to cancel
4. Only sees green checkmark - no cancel option
5. Must know to click outside the card (undiscoverable)

**Suggested Fix:** Always show both X (cancel) and Check (save when available):
```tsx
<div className="flex items-center gap-1">
  <button onClick={cancelEditing}><X /></button>
  <button onClick={handleSave} disabled={!hasChanges}>
    <Check className={hasChanges ? 'text-green' : 'text-gray'} />
  </button>
</div>
```

### Issue 3: Click-Outside Handler Race Condition

**Problem:** The click-outside handler is added with `setTimeout(..., 0)` to avoid triggering immediately, but this creates a race condition where rapid clicks can behave unexpectedly.

```tsx
useEffect(() => {
  if (!isEditing) return;
  
  const handleClickOutside = (e: MouseEvent) => {
    if (radioCardRef.current && !radioCardRef.current.contains(e.target as Node)) {
      cancelEditing();
    }
  };
  
  // Race condition window
  const timer = setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 0);
  
  return () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [isEditing]);
```

**Suggested Fix:** Use `mouseup` instead of `mousedown`, or track the initiating click:
```tsx
const [ignoreNextClick, setIgnoreNextClick] = useState(false);

const startEditing = () => {
  setIgnoreNextClick(true);
  setIsEditing(true);
};

// In click handler
if (ignoreNextClick) {
  setIgnoreNextClick(false);
  return;
}
```

### Issue 4: Save Result Message Position

**Problem:** The `saveResult` message appears in the header next to the icon, which can cause layout shift and may be overlooked.

**Current:** Message appears inline: `"Radio Configuration" ... "Updated: frequency (applied live)" [✓]`

**Better UX Options:**
- Toast notification (non-blocking)
- Banner below header (visible but not in-line)
- Fade-in animation to draw attention

### Issue 5: Form Doesn't Reset on Cancel

**Problem:** When `cancelEditing()` is called, only `isEditing` and `saveResult` are reset. The form values remain in their modified state. If the user re-enters edit mode, they see their previous changes instead of fresh values from config.

```tsx
const cancelEditing = () => {
  setIsEditing(false);
  setSaveResult(null);
  // Missing: reset form values to radioConfig
};
```

**Note:** This is partially mitigated by the `useEffect` that syncs form values when `isEditing` becomes true, but there's a brief render with stale values.

**Suggested Fix:**
```tsx
const cancelEditing = () => {
  setIsEditing(false);
  setSaveResult(null);
  // Reset form to current config values
  if (radioConfig) {
    setFormFrequency((radioConfig.frequency / 1_000_000).toFixed(3));
    setFormBandwidth(radioConfig.bandwidth / 1000);
    setFormSF(radioConfig.spreading_factor);
    setFormCR(radioConfig.coding_rate);
    setFormTxPower(String(radioConfig.tx_power));
  }
};
```

### Issue 6: Dropdown Styling Incomplete

**Problem:** The select dropdowns use `appearance-none` to remove native styling but don't add a custom dropdown indicator, making them look like text inputs.

```tsx
<select
  className="... appearance-none"  // Removes native arrow
>
```

**Suggested Fix:** Add a custom chevron icon:
```tsx
<div className="relative">
  <select className="... appearance-none pr-8">...</select>
  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
</div>
```

### Issue 7: Missing Loading State for Save

**Problem:** While `isSaving` disables the button during save, there's no visual loading indicator. Users may not realize an action is in progress.

**Suggested Fix:** Add a spinner or loading state:
```tsx
{isSaving ? (
  <Loader2 className="w-4 h-4 animate-spin" />
) : (
  <Check className="w-4 h-4" />
)}
```

## Files Affected

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/app/settings/page.tsx` | 49-188 | Edit mode state management |
| `frontend/src/app/settings/page.tsx` | 284-472 | Radio Configuration card render |
| `frontend/src/lib/api.ts` | 212-217 | `updateRadioConfig` API call |

## Resolution (2025-12-13)

All issues addressed in a single commit:

| Issue | Fix Applied |
|-------|-------------|
| 1. Icon State Confusion | Now shows both X (cancel) and Check (save) when editing |
| 2. No Cancel After Changes | Cancel button always visible during edit mode |
| 3. Click-Outside Race | Changed from `mousedown` to `mouseup` event |
| 4. Message Position | Moved to colored banner below header |
| 5. Form Doesn't Reset | `cancelEditing()` now resets all form values |
| 6. Dropdown Styling | Added ChevronDown icons to all select elements |
| 7. Loading State | Added Loader2 spinner during save operation |

### Key Implementation Details

- Used `useCallback` for `cancelEditing` to properly handle dependencies
- Save button disabled when no changes (grayed out check icon)
- Cancel button disabled during save operation
- Status message displays in styled banner with success/error colors
- All dropdowns now have `pr-8` padding and chevron indicator

## Testing Checklist

- [x] Enter edit mode, make changes, click outside → should cancel and reset
- [x] Enter edit mode, make changes, save → should show success, auto-exit
- [x] Enter edit mode, make no changes, click X → should exit
- [x] Verify form values match config after cancel
- [x] Verify dropdowns show current values on edit mode entry
- [x] Verify save error is displayed correctly
- [x] Verify rapid clicking doesn't cause unexpected behavior
