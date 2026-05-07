#!/usr/bin/env bash
# Push 5-star README updates to all Night ecosystem repos.
# Run this from any directory. Repos are cloned to /tmp if not already present.
# Requires: git with GitHub credentials (HTTPS or SSH)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOS=(night-hub night-poker night-fun night-id night-lend night-work night-save night-biz night-store)
READMES=(night-hub night-poker night-fun night-id night-lend night-work night-save night-biz night-store)

echo "🌑 Night Ecosystem README Deployer"
echo "==================================="

for i in "${!REPOS[@]}"; do
  repo="${REPOS[$i]}"
  readme_src="${SCRIPT_DIR}/${READMES[$i]}.md"
  clone_dir="/tmp/push-${repo}"

  echo ""
  echo "→ ${repo}"

  # Clone or update
  if [ -d "$clone_dir/.git" ]; then
    git -C "$clone_dir" pull origin main --quiet
  else
    git clone "https://github.com/kingmunz1994-lgtm/${repo}.git" "$clone_dir" --quiet
  fi

  # Copy README
  cp "$readme_src" "${clone_dir}/README.md"

  # Commit and push
  git -C "$clone_dir" add README.md
  if git -C "$clone_dir" diff --cached --quiet; then
    echo "  ✓ already up to date"
  else
    git -C "$clone_dir" commit -m "docs: 5-star README — ecosystem table, badges, mainnet status"
    git -C "$clone_dir" push origin main
    echo "  ✅ pushed"
  fi
done

echo ""
echo "Done. All Night ecosystem READMEs updated."
