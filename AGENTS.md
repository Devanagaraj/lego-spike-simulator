# Agent instructions for this repository

Read `docs/CONTEXT.md` before editing simulator behavior and `docs/REGRESSION.md` before changing motor, wheel, camera, or startup code. Keep these notes short and update them when invariants change.

The live project is this `lego-spike-simulator-fork` directory. Do not edit the sibling pre-fork repository. Preserve pre-existing user changes; this worktree may be dirty. Use `apply_patch` for source edits. If the environment only permits writes in the sibling workspace root, stage patches there and copy only the changed files into this project after checking targets.

Run `npm run test:simulation`, `npm run check`, and `npm run build` after physics or startup changes. The test command generates an ignored bundle in `tests/.generated`. Do not commit generated bundles or `dist`. If a test fails, report the failure rather than treating a successful build as proof of correct motion.

Both presets use A=left drive, B=right drive, C=colour sensor. The attachment robot's front is its gear end (LDraw +Z, scene -Z); the trainer faces scene +Z. Do not silently rewrite programs when switching robots. The user-authorized AB layout migration updates legacy cached AC/CD movement pairs once. Wheel links must follow a motor when its hub port changes. One powered wheel makes an arc; two equal wheel distances move straight; opposite wheel distances turn in place. Startup must use the same scene pose and camera canvas before and after Play.
