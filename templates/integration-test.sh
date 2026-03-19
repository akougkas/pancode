#!/usr/bin/env bash
# PanCode Integration Test: Build pancode.dev with PanCode
#
# Prerequisites:
#   - PanCode built: npm run build (from PanCode project root)
#   - Local models running (LM Studio on dynamo, llama-server on mini)
#   - PANCODE_WORKER_MODEL set (e.g., dynamo-lmstudio/qwen3.5-35b-a3b...)
#
# This script sets up the test project. The actual test is interactive.

set -euo pipefail

PROJECT_DIR="${1:-/tmp/pancode-dev-site}"
PANCODE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Setting up integration test project at: ${PROJECT_DIR}"

mkdir -p "${PROJECT_DIR}/.pancode"

# Copy web dev agent definitions
cp "${PANCODE_ROOT}/templates/web-dev-agents.yaml" "${PROJECT_DIR}/.pancode/agents.yaml"

# Initialize npm project if not already done
if [ ! -f "${PROJECT_DIR}/package.json" ]; then
  cd "${PROJECT_DIR}"
  npm init -y --silent
  echo "Initialized npm project."
fi

echo ""
echo "Test project ready at: ${PROJECT_DIR}"
echo ""
echo "To run the integration test:"
echo "  cd ${PROJECT_DIR}"
echo "  PANCODE_PACKAGE_ROOT=${PANCODE_ROOT} npm start --prefix ${PANCODE_ROOT}"
echo ""
echo "Test sequence:"
echo "  1. Switch to Capture mode (Shift+Tab)"
echo "  2. Log tasks: Build landing page, hero section, architecture diagram, etc."
echo "  3. Switch to Plan mode"
echo "  4. Switch to Build mode and dispatch agents"
echo "  5. Switch to Review mode for quality checks"
echo "  6. Verify: /runs, /cost, /doctor"
echo ""
echo "Success criteria:"
echo "  - Website renders correctly"
echo "  - Multiple agents contributed"
echo "  - No crashes or orphan processes"
echo "  - /doctor shows all checks passing"
