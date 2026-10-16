// Shared names only. The engine reads each file's own `atom(...)` declarations to list the state a module
// touches, so a file that reads or writes an atom declares it in that file instead of importing it from here.
export const PANE = 'pixel-office'
export const PANE_TITLE = 'Office'
// The keys of the two probes (debug mode) the pane draws, which the ui.message hook recognises.
export const PROBE_TOP = 'probe-top'
export const PROBE_BOTTOM = 'probe-bottom'
