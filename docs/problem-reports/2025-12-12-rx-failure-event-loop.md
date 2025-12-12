# Problem Report: RX Failure Due to Missing Event Loop Capture

**Date:** 2025-12-12  
**Severity:** Critical  
**Duration:** ~2 hours (12:41 - 14:55 PST)  
**Affected Systems:** All meshcore-repeater-linux deployments using pymc_core with GPIO interrupt trampoline

## Summary

Radio RX stopped working entirely after commit `6c25453` removed the call to `radio.check_radio_health()`. This call is required by pymc_core to capture the asyncio event loop for thread-safe GPIO interrupt handling. Without it, all incoming packets were silently dropped.

## Timeline

| Time (PST) | Event |
|------------|-------|
| 12:41:30 | Commit `6c25453` pushed - removed `check_radio_health()` call |
| 12:41:57 | Last successful RX packet received |
| ~13:00 | User reports dashboard not showing new packets |
| 14:20 | Root cause identified |
| 14:55 | Fix deployed (commit `4167196`) |

## Root Cause

### The Hidden Dependency

pymc_core's SX1262 driver uses a "trampoline" pattern for GPIO interrupts:

```python
# In sx1262_wrapper.py
def _irq_trampoline(self):
    """Called by GPIO thread - schedules real handler on event loop."""
    if self._event_loop is not None:
        self._event_loop.call_soon_threadsafe(self._handle_interrupt)
    else:
        # Fallback - but this often fails silently
        self._handle_interrupt()
```

The `_event_loop` variable is set inside `check_radio_health()`:

```python
def check_radio_health(self):
    # ... health checks ...
    loop = asyncio.get_running_loop()
    self._event_loop = loop  # CRITICAL: enables interrupt trampoline
```

### The Breaking Change

Commit `6c25453` simplified `_check_radio_health_async()` to be "informational only":

```python
# BEFORE (working)
if hasattr(radio, "check_radio_health"):
    radio.check_radio_health()  # This captured the event loop

# AFTER (broken)  
if hasattr(radio, "get_health_stats"):
    stats = radio.get_health_stats()  # Informational only - no event loop capture
```

This appeared safe because:
1. The commit message said "informational only, no recovery actions"
2. `get_health_stats()` returns useful data
3. No immediate errors or exceptions occurred
4. TX still worked (uses different code path)

### Why TX Still Worked

TX operations are synchronous and don't rely on GPIO interrupts. The radio can transmit packets without the event loop being captured. Only RX depends on the interrupt trampoline.

## Impact

- **Complete RX failure** - no packets received from radio
- **Dashboard showed stale data** - neighbors list from database, no new entries
- **TX still worked** - periodic adverts sent successfully, masking the problem
- **No error logs** - the trampoline silently fell back to direct calls that failed

## Resolution

Restored the `check_radio_health()` call in commit `4167196`:

```python
async def _check_radio_health_async(self):
    """Check radio health and ensure event loop is captured for GPIO interrupts."""
    radio = getattr(self.dispatcher, "radio", None)
    if not radio:
        return
    
    try:
        # CRITICAL: Call check_radio_health() to capture the event loop
        # This enables the GPIO interrupt trampoline to schedule handlers
        if hasattr(radio, "check_radio_health"):
            radio.check_radio_health()
        # ... rest of health logging ...
```

---

## Recommendations for Hardening

### 1. Make the Dependency Explicit in pymc_core

**Problem:** The event loop capture is a hidden side effect of `check_radio_health()`.

**Solution:** Create a dedicated method and document the requirement:

```python
# In sx1262_wrapper.py
def ensure_event_loop_captured(self):
    """
    MUST be called from an async context before RX will work.
    Captures the event loop for thread-safe GPIO interrupt handling.
    """
    if self._event_loop is None:
        try:
            self._event_loop = asyncio.get_running_loop()
            logger.info("[RX] Event loop captured for GPIO interrupt handling")
        except RuntimeError:
            logger.error("[RX] No event loop available - RX will not work!")
            raise RuntimeError("Event loop required for RX operations")
```

### 2. Add RX Health Monitoring

**Problem:** RX failure was silent - no alerts or errors logged.

**Solution:** Add an RX watchdog that alerts when no packets received:

```python
# In engine.py
async def _check_rx_health(self):
    """Alert if no RX packets received in expected timeframe."""
    if self.rx_count == self._last_rx_count:
        self._rx_stall_count += 1
        if self._rx_stall_count >= 6:  # 1 minute with no RX
            logger.warning(
                f"RX STALL DETECTED: No packets received in {self._rx_stall_count * 10}s. "
                f"Check radio configuration and antenna connection."
            )
    else:
        self._rx_stall_count = 0
    self._last_rx_count = self.rx_count
```

### 3. Add Integration Tests for RX Path

**Problem:** No automated tests verify the RX path works end-to-end.

**Solution:** Add a test that verifies the full RX chain:

```python
# tests/test_rx_integration.py
async def test_rx_event_loop_capture():
    """Verify event loop is captured and RX path is functional."""
    radio = SX1262Radio(config)
    
    # Simulate what the repeater does
    radio.check_radio_health()
    
    # Verify event loop was captured
    assert radio._event_loop is not None, "Event loop not captured - RX will fail!"
    
    # Verify trampoline can schedule handlers
    handler_called = asyncio.Event()
    radio._handle_interrupt = lambda: handler_called.set()
    radio._irq_trampoline()
    
    await asyncio.wait_for(handler_called.wait(), timeout=1.0)
```

### 4. Add Startup Validation

**Problem:** System started successfully but was non-functional.

**Solution:** Add a startup self-test:

```python
# In main.py
async def validate_rx_path(self):
    """Validate RX path is functional during startup."""
    radio = self.dispatcher.radio
    
    # Check event loop capture
    if hasattr(radio, '_event_loop') and radio._event_loop is None:
        logger.error("STARTUP VALIDATION FAILED: Event loop not captured")
        logger.error("RX will not work - check pymc_core integration")
        return False
    
    # Check RX task is running
    if hasattr(radio, 'get_health_stats'):
        stats = radio.get_health_stats()
        if not stats.get('rx_task_alive', False):
            logger.error("STARTUP VALIDATION FAILED: RX task not running")
            return False
    
    logger.info("Startup validation passed - RX path functional")
    return True
```

### 5. Document Critical Dependencies

**Problem:** The relationship between `check_radio_health()` and RX functionality was undocumented.

**Solution:** Add to WARP.md and code comments:

```markdown
## Critical Dependencies

### Event Loop Capture for RX
The `radio.check_radio_health()` method MUST be called periodically from an async
context. This captures the event loop required for GPIO interrupt handling.

Without this call:
- TX will work (synchronous)
- RX will silently fail (no packets received)
- No errors will be logged

This is called every 10 seconds by `_check_radio_health_async()` in engine.py.
DO NOT remove this call without understanding the implications.
```

### 6. Add Dashboard RX Status Indicator

**Problem:** Dashboard showed stale data without clear indication of RX failure.

**Solution:** Add a visual indicator for RX health:

```typescript
// In dashboard
const rxHealthy = stats.rx_count > previousStats.rx_count || 
                  (Date.now() - stats.uptime_seconds * 1000) < 60000;

{!rxHealthy && (
  <Alert variant="warning">
    ⚠️ No packets received recently. Check radio connection.
  </Alert>
)}
```

---

## Lessons Learned

1. **Side effects should be explicit** - A method named `check_radio_health()` shouldn't have the critical side effect of enabling RX. Consider `ensure_rx_ready()` or similar.

2. **Silent failures are dangerous** - The system appeared healthy (TX working, no errors) while completely deaf. Add monitoring for expected behaviors, not just errors.

3. **Test the happy path** - Unit tests that mock the radio won't catch this. Integration tests with real (or simulated) GPIO events are needed.

4. **Document architectural dependencies** - The coupling between the repeater and pymc_core's event loop handling wasn't documented anywhere.

5. **Changes that remove code need extra scrutiny** - The commit appeared to be a safe simplification, but removed a critical call.
