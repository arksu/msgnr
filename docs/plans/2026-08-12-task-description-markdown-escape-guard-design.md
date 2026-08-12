# Task Description Markdown Escape Guard Design

## Goal
Prevent the Web and Tauri task-description clients from saving generated
Markdown punctuation escapes such as `\.` , `\(`, and `\-`.

## Scope
Task descriptions are serialized through the shared
`tiptapJsonToMarkdown()` utility. Tauri packages the Web build output, so one
serializer change protects both clients.

The serializer will normalize generated Markdown punctuation escapes only in
ordinary text nodes before applying text marks. It will remove one escape from
an odd-length backslash run before Markdown punctuation. This removes the
legacy generated escape while preserving literal paths and ordinary unknown
escape sequences, including `C:\folder`.

Code marks, link URLs, image metadata, and table delimiters retain their
specialized structural escaping. The history backend remains unchanged: it
will receive clean values from newly saved descriptions without rewriting
existing audit records.

## Verification
Unit tests cover the reported punctuation forms, repeated serialization, and
literal paths. Run the serializer tests, the frontend production build, and
the Tauri production bundle build, which packages the same `web/dist` output.
