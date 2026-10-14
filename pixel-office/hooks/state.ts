// Shared names only. The engine reads each file's own `atom(...)` declarations to list the state a module
// touches, so a file that reads or writes an atom declares it in that file instead of importing it from here.
export const PANE = 'pixel-office'
export const PANE_TITLE = 'Office'
