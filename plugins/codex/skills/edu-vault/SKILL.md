---
name: edu-vault
description: >-
  Use when the user asks about Obsidian, vaults, organizing projects or notes with Edu, where memory
  lives, or why Obsidian is slow. Triggers: "obsidian", "vault", "organize my projects", "where are my
  notes", "bóveda", "boveda", "organizar mis proyectos", "dónde guarda la memoria", "obsidian lento".
---

# Edu and Obsidian: the brain is the memory, the vault is a window

Answer with this model. Do not invent another folder structure.

## The model

- **Project** = any folder where the user ran `edu init` (a repo, a client, a content line, a research).
- **Brain** = `<project>/.edu/brain/` with the layers `1-canonical/`, `2-episodic/`, `3-transitive/`,
  plus the global brain `~/.edu/brain/` for cross-project preferences and lessons.
  Edu creates and writes these. The user never creates the layer folders by hand.
- **Vault** = the user's dashboard in Obsidian. It **links** to each brain; it never copies notes.

```
~/EduVault/              ← created by `edu vault`
  Home.md                ← entry point (the user may edit outside the edu:projects markers)
  Edu/<project>/         ← link to <project>/.edu/brain
  Edu/_global/           ← link to ~/.edu/brain
  Notes/                 ← the user's own drafts
```

## What to do

1. If the user wants Obsidian: tell them to run **`edu vault`** (or run it yourself when you have a
   shell and the user agrees). It creates the vault in a safe folder, links every known project brain,
   registers it in Obsidian and keeps a backup of Obsidian's config.
2. New project later: `edu init` in that folder, then `edu vault` again to add its link.
3. Health check: `edu vault --check` (broken links, notes per brain, foreign auto-generated notes).
4. Existing knowledge base (e.g. Albert): `edu brain import albert <path>` into a project brain.

## Rules to state plainly

- **Never** use a home folder, a drive root, AppData/Library or other system folders as a vault:
  Obsidian walks the whole tree (EPERM errors, very slow). Push back if the user asks for it.
- **One memory writer.** If other tools also write notes into the vault, say so: duplicated memory
  slows Obsidian and degrades every agent's context.
- Decisions, hypotheses, commitments and lessons go to the brain with `edu_remember`; personal drafts go
  to the vault's `Notes/`.
