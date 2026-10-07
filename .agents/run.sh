#!/usr/bin/env bash
# Run one coding chunk with Haiku 5.5 headless: .agents/run.sh A  (prompt .agents/A.md -> log .agents/A.json)
set -u
cd "$(dirname "$0")/.."
c="$1"
claude -p --model claude-haiku-5-5 --permission-mode acceptEdits \
  --allowedTools "Read Write Edit Glob Grep Bash" \
  --output-format json < ".agents/$c.md" > ".agents/$c.json" 2> ".agents/$c.err"
echo "chunk $c exit $? model=$(grep -o '"modelUsage":{"[^"]*"' ".agents/$c.json" | cut -d'"' -f4)"
