---
name: ai-tutor-cli
description: >-
  Manage the signed-in user's ai-tutor to-do list from a terminal or agent
  context using this repo's `ai-tutor` CLI, instead of the chat UI. Use this
  whenever asked to add, list, filter, or check off to-do items from the
  command line or from an agent session working in this repo — e.g. "put X
  on my list", "what's on my to-do list", "what's still open", "mark Y
  done", "am I logged into ai-tutor", "log me into the todo CLI". Prefer
  this over hand-rolling curl calls against /api/todos or /api/auth — the
  CLI already wraps them and handles auth.
---

# ai-tutor CLI

`ai-tutor` is this repo's command-line client for the user's to-do list —
the terminal/agent-facing equivalent of the chat UI. It's a workspace bin,
so once `npm install` has run at the repo root, `npx ai-tutor <command>`
works from anywhere inside the repo.

## When to reach for it

Use it whenever the task is to add, list, filter, or complete items on the
signed-in user's to-do list from a shell — not from the chat/CopilotKit UI.
It talks to the same server the web app uses (`$AI_TUTOR_SERVER_URL`,
default `http://localhost:3000`), so the dev server has to be running
(`npm run dev`) for any of this to work. A raw `fetch failed` from the CLI
usually means the server is down or the URL is wrong — that's a different
problem from not being logged in, so check for a running server first.

## Login is a prerequisite

Every command except `login`/`logout`/`--help` needs a stored session. If a
command fails with this exact message (exit code 1):

    Not logged in, or the session expired. Run `ai-tutor login`.

it isn't signed in. `ai-tutor login` starts Better Auth's device-code flow:
it prints a one-time code and a URL, then blocks, polling until someone
approves the code there while signed in to the web app. That approval step
needs a human in a browser — there is no password prompt and no
non-interactive way to complete it. So when this happens: **run
`ai-tutor login`, then tell the user the code and the URL and ask them to
approve it in their browser.** Once they confirm, either the still-running
`login` command will have unblocked on its own, or re-run the command that
originally failed. Don't invent credentials or try to work around this.

## One example per command

```
ai-tutor login                               # prints a code + URL, waits for approval
ai-tutor whoami                              # prints the signed-in user's email
ai-tutor add "Buy milk"                      # adds an item
ai-tutor list                                # lists every item, oldest first
ai-tutor list --filter milk                  # lists only items whose title contains "milk"
ai-tutor done 3f9c1e2a-2b7e-4b0a-9c1a-...     # marks one item done, by id from `list`
ai-tutor logout                              # invalidates the session and clears it locally
```

`add`, `list`, and `done` cover most "manage my list" requests; `whoami`,
`login`, and `logout` are for establishing or checking identity.

## `--help` is the source of truth

This skill deliberately doesn't restate every flag or edge case. Before
relying on exact syntax or behavior, run `ai-tutor --help` or
`ai-tutor <command> --help` — the CLI's own help text is authoritative and
will stay correct even if this skill goes stale.
