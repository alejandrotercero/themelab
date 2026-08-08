# Desktop overlay fidelity (2026-08-08)

- Treat the existing CLI overlay as the product reference. The Electron shell must
  reproduce its chrome, controls, icons, interaction semantics, and layout closely;
  a working preview with approximate native controls is not sufficient.
- Compare each desktop surface against the source files in `packages/overlay/src`
  before calling a parity pass complete, and verify the native compositor boundaries
  do not hide or disable adjacent controls.
- Do not recreate overlay icons from memory or a generic icon library. Copy the
  exact SVG path/paint treatment from the source control and remove any desktop
  control the user has explicitly deferred (such as infinite-canvas toggling).
- Visual diagrams must represent live selected values; static placeholder values
  are a parity bug even when their surrounding layout resembles the source.
