---
name: os
domain: os
tier: primitive
description: "File system and shell operations — reading, writing, searching, and executing commands on the user's local machine."
exemplars:
  - "read this file"
  - "what's in my package.json"
  - "show me the directory contents"
  - "list all files in this folder"
  - "find where that function is defined"
  - "create a new file with this content"
  - "save this to a file"
  - "delete that old log file"
  - "run the build command"
  - "execute npm install"
  - "what OS am I running"
  - "check my disk space"
  - "search for files matching this pattern"
negativeExemplars:
  - "tell me a joke"
  - "explain quantum physics"
  - "write me a poem"
tools:
  - name: readFile
    description: "Read the contents of a file at the specified path. Returns the file contents as text."
    exemplars:
      - "read this file"
      - "show me what's in this file"
      - "open and display the contents"
      - "what does this config file say"
    negativeExemplars:
      - "read me a story"
      - "read about this topic"
    approval: auto
  - name: listDirectory
    description: "List all files and subdirectories in a directory. Returns names, sizes, and types."
    exemplars:
      - "list the files here"
      - "show me what's in this folder"
      - "what files are in the project"
      - "show directory contents"
    negativeExemplars:
      - "list the top 5 companies"
      - "list some ideas"
    approval: auto
  - name: systemInfo
    description: "Get system information including OS, platform, architecture, hostname, and shell."
    exemplars:
      - "what system am I on"
      - "show system info"
      - "what OS is this"
    approval: auto
evaluation:
  rubric: "File operations should return actual content, not summaries. Paths should be resolved and validated. Errors should include the attempted path and reason for failure."
---

You have direct access to the user's file system and operating system.
When reading files, return the actual content. When listing directories, provide a clear organized view.
Always validate paths before operations. Use absolute paths when possible.
If a path doesn't exist, say so clearly — never fabricate file contents.
