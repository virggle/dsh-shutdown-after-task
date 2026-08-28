# Changelog

## v0.2.0 (2026-08-29)

- **Draggable button**: move it anywhere; position persists in localStorage
  (`dsh-sat-pos`). Dragging suppresses the click, so arming still works.
- **Auto-dodge**: when another plugin's corner popup (a fixed overlay with
  clickable content, e.g. a price notice with a button) overlaps the button,
  the button steps aside automatically and returns once the popup is gone.
  Detected via MutationObserver + periodic scan; 30 %+ overlap required to
  avoid false positives.
- **Panel follows button**: the countdown banner / notice is anchored above
  the button wherever it currently sits (falls below when there is no room).
- Published to npm (`dsh-shutdown-after-task@0.2.0`) with `repository` /
  `homepage` fields pointing back at the GitHub repo.

## v0.1.0 (2026-08-16)

- Initial release.
- Floating "任务完成后关机 / Shutdown after task" button (bottom-right) to arm
  the mode; off by default.
- Cancellable 60 s countdown banner with a "取消关机 / Cancel shutdown" button
  (`shutdown /a`); cancelling also disarms the mode.
- New task during the countdown aborts the shutdown while keeping the mode.
- Success-only trigger: a batch with `agent/error` is skipped with a notice.
- Configurable via `cordis.patch.yml`: `countdownSec`, `marginSec`,
  `onlyOnSuccess`.
- Windows only (`shutdown.exe`); inert with a log line elsewhere.
- Runtime log at `$DSH_HOME/dsh-shutdown-after-task.log`.
