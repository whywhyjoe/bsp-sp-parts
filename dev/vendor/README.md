# dev/vendor — dev-only design-system copies

These are **snapshots for the dev harness only**, copied from a local clone of
`whywhyjoe/bsp-design-system` so the harness pages open from disk:

- `colors_and_type.css`
- `components.css`

They are **never deployed**. Live pages link the design system where it already
runs in production: `/sites/FCUPortal/Code/bsp-design/styles.css`.

To refresh after a design-system release, re-copy the two files from the
design-system repo (they carry their own `/*! … vX.Y.Z … */` version banner).
