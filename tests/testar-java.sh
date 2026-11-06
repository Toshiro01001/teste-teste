#!/bin/sh
# Compila o servidor e os testes com o javac da máquina e executa tudo. Não baixa nada.
set -e
cd "$(dirname "$0")/.."
rm -rf tests/out
mkdir -p tests/out
javac --release 17 -Xlint:all,-serial -encoding UTF-8 -d tests/out servidor-java/src/fichario/*.java tests/java/fichario/*.java
java -Dstdout.encoding=UTF-8 -cp tests/out fichario.TestesApi dados/registros.json
