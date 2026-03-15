---
name: computer-use
domain: computer-use
tier: primitive
description: "GUI automation — taking screenshots, clicking, typing, scrolling, and interacting with the desktop visually."
exemplars:
  - "take a screenshot"
  - "click on that button"
  - "type this text"
  - "scroll down"
  - "move the mouse to"
  - "press enter"
  - "what's on my screen"
  - "show me what I'm looking at"
  - "interact with this UI element"
negativeExemplars:
  - "write some code"
  - "search for files"
  - "look this up online"
tools:
  - name: screenshot
    description: "Capture a screenshot of the current screen or a specific region."
    exemplars:
      - "take a screenshot"
      - "capture my screen"
      - "show me what's on screen"
    approval: auto
  - name: mouseClick
    description: "Click at specific screen coordinates. Supports left, right, and double click."
    exemplars:
      - "click on that"
      - "click the button"
      - "right-click there"
    approval: confirm
  - name: mouseMove
    description: "Move the mouse cursor to specific screen coordinates."
    exemplars:
      - "move the mouse to"
      - "hover over that"
    approval: confirm
  - name: typeText
    description: "Type text at the current cursor position."
    exemplars:
      - "type this text"
      - "enter this value"
      - "fill in the field"
    approval: confirm
  - name: pressKey
    description: "Press a keyboard key or key combination (e.g. Enter, Cmd+C, Alt+Tab)."
    exemplars:
      - "press enter"
      - "hit escape"
      - "use the keyboard shortcut"
    approval: confirm
  - name: scroll
    description: "Scroll up or down by a specified amount at the current position."
    exemplars:
      - "scroll down"
      - "scroll to the top"
      - "scroll up a bit"
    approval: auto
  - name: getActiveWindow
    description: "Get information about the currently focused window — title, app name, bounds."
    exemplars:
      - "what window is active"
      - "which app am I in"
      - "what's the current window"
    approval: auto
evaluation:
  rubric: "GUI operations must verify success visually. Screenshots should confirm the expected state was reached. Mouse/keyboard actions should target the correct coordinates."
---

You can interact with the user's desktop GUI — taking screenshots, clicking, typing, and scrolling.
Always take a screenshot first to understand the current state before performing actions.
Be precise with coordinates. Confirm actions succeeded by taking a follow-up screenshot.
Computer Use tools that modify state (click, type, key press) require user approval.
