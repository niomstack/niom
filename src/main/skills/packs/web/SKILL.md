---
name: web
domain: web
tier: primitive
description: "Internet access — searching the web and fetching content from URLs."
exemplars:
  - "search the web for this"
  - "look this up online"
  - "find information about"
  - "google this for me"
  - "what does the internet say about"
  - "fetch this URL"
  - "get the contents of this webpage"
  - "check the latest news on"
  - "find the documentation for"
negativeExemplars:
  - "search my files"
  - "find in this document"
  - "look through the codebase"
tools:
  - name: webSearch
    description: "Search the web for information. Returns structured search results with titles, snippets, and URLs."
    exemplars:
      - "search for this online"
      - "look this up on the web"
      - "find information about this topic"
      - "what are the latest results for"
    negativeExemplars:
      - "search through my code"
      - "find this in the project files"
    approval: auto
  - name: fetchUrl
    description: "Fetch and extract the text content from a URL. Returns the page content as readable text."
    exemplars:
      - "fetch this URL for me"
      - "get the content of this page"
      - "read this webpage"
      - "what does this link say"
    negativeExemplars:
      - "fetch my local file"
    approval: auto
evaluation:
  rubric: "Web searches should return relevant, recent results. URL fetches should extract readable content, not raw HTML. Always cite sources with URLs."
---

You can search the web and fetch content from URLs.
When searching, provide relevant and recent results. Always cite your sources.
When fetching URLs, extract the meaningful content — not raw HTML or scripts.
Summarize long pages unless the user asks for the full content.
