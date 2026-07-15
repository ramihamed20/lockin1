# Focus frontend subsystem

Phase 2 defines contracts only. It does not ship a PDF viewer or annotation UI.

The subsystem separates viewport rendering, annotation persistence, workspace-state recovery,
pointer/gesture interpretation, keyboard commands, tool registration, and focus-session APIs.
Pointer contracts expose browser-reported pressure and tilt without claiming that browsers can
guarantee palm rejection. All annotation coordinates are normalized to the PDF page so zoom and
viewport changes do not rewrite the stored data.

The shape chooser is a toolbar grouping; line, arrow, rectangle, and circle remain independently
registered tools. Later tools can register without modifying a central drawing component.
