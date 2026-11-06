#!/bin/sh
# Roda todos os testes: Java, SQL e navegador. Precisa de JDK, Python 3, Node e Playwright.
set -e
cd "$(dirname "$0")/.."
sh tests/testar-java.sh
python3 tests/testar-sql.py
NODE_PATH=$(npm root -g) node tests/e2e.js
