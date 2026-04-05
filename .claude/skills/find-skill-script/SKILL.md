---
name: find-skill-script
description: Locate the absolute path of one or more bundled skill script files. Use this skill whenever you need to find the actual on-disk path of scripts that ship with a skill (e.g. tabelog_search.js, install-playwright-cli.sh, cli.config.json) before running them with node or bash, because scripts may be mounted at different paths depending on the environment.
allowed-tools: Bash
---

# Find Skill Script

Use this skill to resolve absolute paths of skill scripts before executing them.

## Step — Run the find command

Choose the appropriate form depending on whether the caller specifies a subdirectory:

**With subdirectory constraint** (e.g. file must be inside `scripts/`):
```bash
find /mnt/skills/user /root/.claude/skills /home/user -path "*/<subdir>/<script_filename>" 2>/dev/null | head -1
```

**Without subdirectory constraint** (file can be anywhere under the skill):
```bash
find /mnt/skills/user /root/.claude/skills /home/user -name "<script_filename>" 2>/dev/null | head -1
```

If you need multiple files, run the command once per filename.

The command searches common skill mount points in order:
1. `/mnt/skills/user` — runtime skill mount (Claude Code on the web)
2. `/root/.claude/skills` — global install path
3. `/home/user` — local project path

## Output

The returned line is the absolute path. Use it in all subsequent `node <path>` or `bash <path>` calls instead of any relative path.

If the command returns nothing, the script is not available in this environment — report the error to the user.
