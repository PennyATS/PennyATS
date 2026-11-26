# Agent instructions

## Issue tracking

Create a detailed GitHub issue for every user prompt about this repository, including fixes, features, design changes, questions, and follow-up requests. Create separate issues when one prompt contains distinct requests. Do this before starting implementation whenever GitHub is available.

Each issue must capture the user's request and context, the intended scope, concrete acceptance criteria, and how the result will be verified. Update the issue with material decisions and the final outcome. If issue creation is temporarily unavailable, prepare the issue details and create it as soon as access returns. Link the issue in the response to the user.

## Commit attribution

When ChatGPT Codex materially contributes to a commit, keep the human contributor as the primary Git author and add this trailer at the end of the commit message, after a blank line:

`Co-authored-by: ChatGPT Codex <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>`

Add the trailer only to commits containing ChatGPT Codex work. Preserve any other applicable co-author trailers. Do not rewrite existing commits solely to add attribution.

## Roadmap

Read [ROADMAP.md](ROADMAP.md) before planning or proposing work. It holds the long-term direction, including the agent-ready API and MCP server, security and compliance goals, and careers-page parity, with links to the GitHub issues. The issues and the GitHub project board are the live source of truth for status. When a request changes the direction, update ROADMAP.md in the same pull request.
