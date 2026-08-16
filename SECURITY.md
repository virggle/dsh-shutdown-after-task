# Security Policy

This plugin executes `shutdown.exe` on your own machine — that is its entire
purpose. Review before you trust:

- The plugin is **Windows-only** and refuses to arm on other platforms.
- The GUI button and HTTP routes are the only ways to arm it; it never arms
  itself.
- Destructive POST routes (`/arm`, `/disarm`, `/cancel`) reject non-loopback
  Origins.
- The injected UI script and routes are served by the same loopback web server
  the DSH GUI uses.

## Reporting a Vulnerability

Open an issue in this repository, or contact the maintainers directly.
Because this plugin can power the machine off, please describe the exact
conditions that trigger the behavior you are reporting.
