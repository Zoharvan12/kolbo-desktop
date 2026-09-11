#!/usr/bin/env bash
#
# One detector for the recurring C2 loader, shared by every place that has to say no.
# This copy lives at .github/scan-c2.sh so that repos whose deploy workflow carries
# `paths-ignore: .github/**` (kolbo-map) can receive guard updates without triggering a
# production deploy. kolbo-api keeps its copy at scripts/security/scan-c2.sh because its
# deploy gate already references that path.
#
# Callers:
#   - .github/workflows/malware-scan.yml   (every push / PR)
#   - ~/.git-hooks-global/pre-commit       (staged content, before it becomes a commit)
#
# It used to live in three places with three different rule sets, and that is exactly how
# the 2026-08-16 infection reached master: the local hook matched only LEADING padding
# (^[ ]{100,}) while the payload pads mid-line, so the hook passed and CI failed. One file,
# one rule set, no drift.
#
# Usage:
#   scan-c2.sh                # scan tracked source (git ls-files)
#   scan-c2.sh FILE [FILE...] # scan the given files (the hook passes staged blobs)
#
# Exit 0 = clean, 1 = something matched. Deliberately variant-agnostic: it matches on
# STRUCTURE and IOCs, not on one payload, because every cleanup so far has been followed
# by a new variant that the previous signature missed.

set +e   # every exit code is handled explicitly; `bash -e` would abort on a false test
FAIL=0

if [ "$#" -gt 0 ]; then
  FILES=$(printf '%s\n' "$@")
else
  FILES=$(git ls-files '*.js' '*.mjs' '*.cjs' '*.ts' \
    | grep -vE '(^|/)(node_modules|dist|build)/|\.min\.(js|ts)$|\.map$')
fi

if [ -z "$FILES" ]; then
  echo "scan-c2: no source files to scan"
  exit 0
fi

report() {
  # $1 = file, $2 = message. GitHub renders ::error, a terminal just sees the text.
  if [ -n "$GITHUB_ACTIONS" ]; then
    echo "::error file=$1::$2"
  else
    echo "  x $1: $2"
  fi
  FAIL=1
}

# Batched on purpose: one grep over the whole list, not one grep per file. The per-file
# loop this replaced took over five minutes on a dev checkout (a process spawn per file,
# three times over) — slow enough that someone would be tempted to skip it.
scan_list() { printf '%s\n' "$FILES" | tr -d '\r' | xargs -d '\n' -r "$@" 2>/dev/null; }

# 1. Injection padding: a long run of spaces followed by code, ANYWHERE in the line.
#    Every variant to date hides the payload behind padding after a real statement
#    (`module.exports = router;` + 200 spaces + code). 100 is calibrated: catches the
#    real payload, zero false positives repo-wide.
for f in $(scan_list grep -lP '[ ]{100,}\S'); do
  report "$f" "injection padding (100+ spaces mid-line followed by code)"
done

# 2. Known IOCs across every observed variant (A8-1955, A9-1672, EtherHiding). The 2026-08
#    variant carries NO hardcoded IP — it resolves the C2 from chain state — so
#    eth_getBlockByNumber and the ESM require-shim are the load-bearing entries here.
IOC="eth_getBlockByNumber|blockscout\.com/api|166\.88\.[0-9]+\.[0-9]+|136\.0\.9\.8|global\['_V'\]|global\['!'\]"
for f in $(scan_list grep -lE "$IOC"); do
  report "$f" "known C2 loader IOC present"
done

# 2b. The ESM require-shim, but ONLY in a CommonJS file. `createRequire(import.meta.url)`
#     is how a real .mjs script reaches a CJS dependency (scripts/model-icons/*.mjs does
#     exactly that, legitimately). In a .js/.cjs file it means someone appended ESM syntax
#     to a CommonJS module — which is precisely what the 2026-08 payload does, and what
#     crashed the production boot check.
for f in $(scan_list grep -lF 'createRequire(import.meta'); do
  case "$f" in
    *.mjs) continue ;;
  esac
  report "$f" "ESM require-shim inside a CommonJS file — injected loader signature"
done

# 3. Unicode-escape obfuscation density. The loader encodes nearly every string as \uXXXX
#    to defeat plain grep; legitimate source never does this at volume in one file. Narrow
#    with a fixed-string pass first, then count only the handful that contain any at all.
for f in $(scan_list grep -lF '\u00'); do
  n=$(grep -oP '\\u00[0-9a-fA-F]{2}' "$f" 2>/dev/null | wc -l)
  if [ "${n:-0}" -gt 100 ]; then
    report "$f" "$n unicode escapes — obfuscated payload signature"
  fi
done

# 5. The DROPPER KIT — the carrier, not the payload. Checks 1-4 only ever looked at
#    *.js/*.mjs/*.cjs/*.ts, so the three files that actually gave the loader execution on
#    2026-08-16 were invisible to this scanner by construction:
#      .vscode/settings.json  task.allowAutomaticTasks:true — overrides the user-level
#                             "off", and carries its own inline runOn:folderOpen task
#      .vscode/tasks.json     runOn:folderOpen, hide:true -> node ./public/fonts/*.woff2
#      public/fonts/*.woff2   not a font: magic bytes 20202020 (spaces), JS inside
#    Removing 2 of the 3 is what failed five cleanups in a row. Never narrow this back to
#    a source-file extension list.
if [ "$#" -gt 0 ]; then ASSETS=$(printf '%s\n' "$@"); else ASSETS=$(git ls-files); fi

# 5a. A font must start with a real font signature: wOF2 / wOFF / OTTO / 00010000 / true / ttcf.
for f in $(printf '%s\n' "$ASSETS" | tr -d '\r' | grep -iE '\.(woff2?|ttf|otf|ttc)$'); do
  [ -f "$f" ] || continue
  magic=$(head -c 4 "$f" 2>/dev/null | od -An -v -tx1 | tr -d ' \n')
  case "$magic" in
    774f4632|774f4646|4f54544f|00010000|74727565|74746366) ;;
    *) report "$f" "not a font — magic bytes '$magic', expected wOF2/wOFF/OTTO/00010000" ;;
  esac
done

# 5b. No binary asset may contain executable JavaScript.
for f in $(printf '%s\n' "$ASSETS" | tr -d '\r' | grep -iE '\.(woff2?|ttf|otf|ttc|eot|png|jpe?g|gif|webp|ico|mp4|mp3|wav|zip|7z|exe|dll|pdf)$'); do
  [ -f "$f" ] || continue
  if grep -qaE "require\(|module\.exports|child_process|createRequire|process\.(env|argv)|eval\(" "$f" 2>/dev/null; then
    report "$f" "JavaScript inside a binary asset — dropper disguised as media"
  fi
done

# 5c. The editor auto-execution vector, in both files that can arm it.
for f in $(printf '%s\n' "$ASSETS" | tr -d '\r' | grep -E '(^|/)\.vscode/(settings|tasks)\.json$'); do
  [ -f "$f" ] || continue
  case "$f" in
    */tasks.json)
      grep -q 'folderOpen' "$f" 2>/dev/null \
        && report "$f" "runs on folderOpen — editor auto-execution vector" ;;
    */settings.json)
      grep -qE '"task\.allowAutomaticTasks" *: *"?(on|true)"?' "$f" 2>/dev/null \
        && report "$f" "task.allowAutomaticTasks overrides the user-level off — auto-execution vector"
      grep -q '"runOn" *: *"folderOpen"' "$f" 2>/dev/null \
        && report "$f" "inline runOn:folderOpen task in workspace settings" ;;
  esac
done

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Malware guard FAILED. Do not merge or deploy."
  echo "Runbook: memory project_recurring_c2_malware"
  exit 1
fi

echo "scan-c2: clean"
exit 0
