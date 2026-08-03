# Task URL Copy Design

## Goal

Let a user copy the canonical URL of the open task from the task-card header.

## Interface

Add a `Copy task URL` secondary button immediately before `Export to PDF`.

## Behavior

On click, construct the URL from the active browser protocol and `window.location.host`, followed by `/tasks/` and the task's canonical lowercase public ID. Write that URL through the Clipboard API. Show the existing toast on success or clipboard failure.

## Verification

Add a component test that clicks the button and checks the clipboard receives the current host plus the canonical task route.
