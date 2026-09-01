# Background UI audit

Kolbo Studio can be audited without taking over the active Windows desktop.
The audit process launches a second Electron instance with its window rendered far
outside the desktop bounds and shown without activation,
then controls the renderer through a private local Chrome DevTools Protocol port.
It never uses the physical mouse or keyboard and never creates a taskbar or tray item.

## Full authenticated audit

```powershell
npm run audit:ui
```

This seeds a separate audit profile from the saved Kolbo Studio authentication token
so the off-screen instance can inspect every authenticated desktop surface. It never
runs against the normal profile, and it does not print or include authentication
tokens in the report. Any storage writes or logout caused by the audited app stay in
the audit profile. It only clicks the desktop shell's navigation controls; it
does not start downloads, conversions, generations, purchases, or destructive actions.
The runner restores the previously saved desktop view before it exits.

## Isolated sign-in audit

```powershell
npm run audit:ui:isolated
```

This uses a separate `kolbo-desktop-ui-audit-signed-out` profile and is intended for
the sign-in experience. It does not inherit either the normal app session or the
authenticated audit session.

## Results

By default, each run writes to the operating system's temporary directory under:

```text
kolbo-ui-audit/<timestamp>/
```

The folder contains a screenshot for every available surface, `report.md`, detailed
machine-readable findings in `report.json`, and the accessibility tree in
`accessibility.json`. Use `--output <folder>` with `node scripts/ui-audit.js` when a
persistent custom destination is required.

The background audit covers renderer layout, translations, accessibility structure,
basic contrast, target sizing, overflow, runtime errors, and performance metrics.
Native file dialogs, Explorer drag-and-drop, tray behavior, installer/update behavior,
and physical window resizing still require a short explicitly approved visible smoke.
