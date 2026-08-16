# Changelog

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
