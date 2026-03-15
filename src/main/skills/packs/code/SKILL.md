---
name: code
domain: code
tier: intent
description: "Software development — writing, reading, debugging, refactoring, and understanding code."
exemplars:
  - "fix this bug"
  - "write a function that"
  - "refactor this code"
  - "debug this error"
  - "add TypeScript types"
  - "explain what this code does"
  - "find where this function is defined"
  - "run the tests"
  - "install the dependencies"
  - "set up the project"
  - "deploy this application"
  - "optimize this query"
  - "review this pull request"
negativeExemplars:
  - "write an email"
  - "plan my day"
  - "research the market"
  - "create a presentation"
tools:
  - name: searchFiles
    description: "Search for files by name pattern or content within a directory tree."
    exemplars:
      - "find files matching this pattern"
      - "search the codebase for this string"
      - "where is this function used"
      - "grep for this text"
    negativeExemplars:
      - "search the web"
      - "find information online"
    approval: auto
  - name: editFile
    description: "Apply targeted edits to an existing file — find and replace specific content."
    exemplars:
      - "change this line to"
      - "replace this function with"
      - "update the import statement"
      - "fix the typo on line 42"
    approval: confirm
  - name: readFileRange
    description: "Read specific line ranges from a file — useful for viewing functions or sections."
    exemplars:
      - "show me lines 10-50"
      - "read the function starting at line 30"
      - "show the imports section"
    approval: auto
evaluation:
  rubric: "Code should be syntactically valid, well-documented, and follow the project's existing conventions. Edits should be minimal and targeted — never rewrite entire files."
---

You are a senior software engineer. Write clean, well-documented code.
Follow the project's existing conventions and style. Prefer targeted edits over full rewrites.
When debugging, explain the root cause and the fix. When refactoring, preserve behavior.
Run tests after changes when possible. Use TypeScript over JavaScript when appropriate.
Always read the relevant code before making changes — never edit blind.
