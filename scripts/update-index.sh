#!/bin/bash
set -e

# Setup Instructions (Ubuntu):
# 1. Open crontab: crontab -e
# 2. Add this line (replace /path/to/project with the actual absolute path):
#    0 * * * * cd /path/to/project && ./scripts/update-index.sh >> ./update-index.log 2>&1
# 3. Ensure this script has execute permissions: chmod +x scripts/update-index.sh

# Ensure common binary paths are in PATH for cron
export PATH="/home/kevin/.local/bin:/home/kevin/.local/share/mise/shims:$PATH"

# Load mise environment if available
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash --sessions)"
fi

# Ensure we are in the project root if run from elsewhere
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
cd "$SCRIPT_DIR/.."

# Configuration
REPO_URL=git@github.com:sudorandom/livemap.kmcd.dev.git
BRANCH="main"
DATA_DIR="web/public/data"

# 1. Do a sparse clone/checkout of the data directory
TEMP_DIR=$(mktemp -d)
export MISE_YES=1

echo "Cloning $REPO_URL into $TEMP_DIR (sparse)..."
git clone --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
export MISE_TRUSTED_CONFIG_PATHS="$(pwd)"
git sparse-checkout set "$DATA_DIR"

# 2. Run the indexer (pointed at that directory)
echo "Running indexer on $DATA_DIR..."
# Use 'mise x' (exec) to run the binary from the specific tool/version
mise x github:sudorandom/livemap.kmcd.dev@latest -- bgp-indexer "$DATA_DIR"

# 3. Check in the changes and commit
git add "$DATA_DIR"
if git diff --cached --quiet; then
    echo "No changes to commit."
else
    git commit -m "data: update bgp index data"
    
    # 4. Push the commit to main
    echo "Pushing to $BRANCH..."
    git push origin "$BRANCH"
fi

# Cleanup
cd /
rm -rf "$TEMP_DIR"
echo "Update complete."
