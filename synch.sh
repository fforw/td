#!/bin/bash
# Builds the demo and publishes it with medium (https://github.com/fforw/medium):
# uploads docs/, takes the card screenshot and updates the list page.
#
#   ./synch.sh [variant] [--slug <slug>] [--pick]
set -e
# medium takes the slug and docs/ from the current directory
cd "$(dirname "$0")"
pnpm run build
medium deploy "$@"
