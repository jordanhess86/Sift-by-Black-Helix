#!/bin/sh
# Runs the automated tests. They use made-up data and never contact ChatGPT.
cd "$(dirname "$0")" || exit 1
mkdir -p web
status=0
for test in test_*.js; do
  echo "--- $test"
  node "$test" || status=1
done
# Some tests also write browser test pages, which aren't needed after this.
rm -rf web preview2.html preview3a.html preview3b.html preview4.html
if [ "$status" -eq 0 ]; then echo "All tests passed."; else echo "SOME TESTS FAILED."; fi
exit "$status"
