---
name: find-skill-script
description: Locate the absolute path of a bundled skill script file. Use this skill whenever you need to find the actual on-disk path of a script that ships with a skill (e.g. tabelog_search.js, any_script.js) before running it with node or bash, because the script may be mounted at different paths depending on the environment.
allowed-tools: Bash
---

# Find Skill Script

Use this skill to resolve the absolute path of a skill script before executing it.

## Step — Run the find command

Replace `<script_filename>` with the exact filename (e.g. `tabelog_search.js`):

```bash
find /mnt/skills/user /root/.claude/skills /home/user -name "<script_filename>" 2>/dev/null | head -1
```

The command searches common skill mount points in order:
1. `/mnt/skills/user` — runtime skill mount (Claude Code on the web)
2. `/root/.claude/skills` — global install path
3. `/home/user` — local project path

## Output

The returned line is the absolute path. Use it in all subsequent `node <path>` or `bash <path>` calls instead of any relative path.

If the command returns nothing, the script is not available in this environment — report the error to the user.
