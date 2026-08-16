# dsh-shutdown-after-task

Shut down Windows automatically after DeepSeek Harness tasks complete.
Zero-dependency plugin for the DeepSeek Harness web profile.

Run long tasks (batch migrations, model generation, overnight jobs)? Click the
"任务完成后关机 / Shutdown after task" button in the bottom-right corner and the
computer shuts down once the tasks finish — with a cancellable countdown.

[中文](README.md)

## Features

- **Floating text button** (bottom-right): toggles the "shutdown after task
  completes" mode. Off by default — never arms itself.
- **Cancellable countdown**: when the task completes, a 60 s banner shows the
  remaining seconds with a **Cancel shutdown** button (`POST /cancel` →
  `shutdown /a`) — no reliance on the OS notification that cannot be cancelled.
- **New-task interrupt**: starting a new task during the countdown aborts the
  shutdown automatically while keeping the mode armed.
- **Cancel exits the mode**: clicking "Cancel shutdown" aborts this shutdown
  AND disarms the mode, so the next task will not trigger another one.
- **Success-only**: a batch with `agent/error` is skipped (banner notice), mode
  stays armed.
- **Multi-session aware**: "task complete" = all root sessions idle
  (subagents fold into their root).

## Install

```sh
dsh plugin --profile web add github:<owner>/dsh-shutdown-after-task
```

Restart DSH, then refresh the page (Ctrl+R) if the button does not appear.

## Usage

1. Click "任务完成后关机" — the button turns yellow (armed).
2. Run your tasks.
3. All root sessions idle with no errors → countdown banner appears.
4. Click "取消关机 / Cancel shutdown" to abort this shutdown and exit the mode;
   or let the countdown run out — the computer shuts down.

## Config

Edit the profile's `cordis.patch.yml`:

```yaml
- id: dsh-shutdown-after-task
  config:
    countdownSec: 60      # countdown seconds (10–600, default 60)
    marginSec: 5          # extra seconds on the OS `shutdown /t` (0–60, default 5)
    onlyOnSuccess: true   # shutdown only on a clean batch (false = shut down either way)
```

## Behavior

| Item | Detail |
|---|---|
| Trigger | after arming, all root sessions go idle |
| Success check | no `agent/error` in the batch (when `onlyOnSuccess: true`) |
| Countdown | `countdownSec` s, live banner, cancel button |
| OS command | `shutdown /s /t <countdownSec + marginSec>` at countdown start |
| Cancel | GUI button (exits mode) / new task during countdown (keeps mode) |
| State | `GET http://127.0.0.1:<port>/api/dsh-shutdown-after-task/state` |

## Log

`$DSH_HOME/dsh-shutdown-after-task.log` — mount, arm, trigger, and cancel events.

## How it works

- Plain config-layer cordis plugin: `webServer.tapIndex` injects the UI script
  into every index response; host HTTP routes back the state and actions.
  No client bundle, no build step.
- Listens to `agent/status` / `agent/error` (see `@deepseek-ai/dsh-agent`
  runtime-types).
- Routes and injection are disposed on unload.

## Limitations

- **Windows only** (`shutdown.exe`); inert with a log line on other platforms.
- Mode state is in-memory: DSH restart resets it to off.
- A root session that is idle but has queued inbox work still counts as idle.
- The button appears after a page refresh (script injected per index response).

## Uninstall

```sh
dsh plugin --profile web remove dsh-shutdown-after-task
```

## Credits

- Event wiring modeled after [yang040709/dsh-win-toast-notify](https://github.com/yang040709/dsh-win-toast-notify) (MIT)
- Plugin structure modeled after [keyiadiannao/dsh-power-button](https://github.com/keyiadiannao/dsh-power-button) (MIT)

## License

MIT
