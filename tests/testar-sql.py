#!/usr/bin/env python3
"""Executa o esquema em SQLite, carrega os dados e confere restrições e consultas."""
import json, pathlib, sqlite3, sys

raiz = pathlib.Path(__file__).resolve().parent.parent
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript((raiz / "servidor-java/sql/esquema.sql").read_text(encoding="utf-8"))
dados = json.loads((raiz / "dados/registros.json").read_text(encoding="utf-8"))
campos = ("id", "nome", "idade", "cidade", "situacao", "data", "descricao")
db.executemany("INSERT INTO registro VALUES (?,?,?,?,?,?,?)", [[r[c] for c in campos] for r in dados])
falhas = 0

def checar(nome, ok):
    global falhas
    print(("ok    " if ok else "FALHA ") + nome)
    falhas += 0 if ok else 1

def recusa(nome, sql, args):
    try:
        db.execute(sql, args)
        checar(nome, False)
    except sqlite3.IntegrityError:
        checar(nome, True)

checar("todos os registros entram", db.execute("SELECT COUNT(*) FROM registro").fetchone()[0] == len(dados))
base = ["REG-9999", "Teste", 30, "Vila Exemplo", "em_aberto", "2025-01-01", "descricao de teste"]
recusa("recusa idade 17", "INSERT INTO registro VALUES (?,?,?,?,?,?,?)", base[:2] + [17] + base[3:])
recusa("recusa situação desconhecida", "INSERT INTO registro VALUES (?,?,?,?,?,?,?)", base[:4] + ["xpto"] + base[5:])
recusa("recusa id repetido", "INSERT INTO registro VALUES (?,?,?,?,?,?,?)", [dados[0]["id"]] + base[1:])
recusa("recusa informação de ficha inexistente", "INSERT INTO informacao (registro_id, local, data, relato) VALUES (?,?,?,?)", ["REG-9999", "x", "2025-01-01", "y"])
db.execute("INSERT INTO informacao (registro_id, local, data, relato) VALUES (?,?,?,?)", [dados[0]["id"], "Praça", "2025-01-01", "relato de teste"])
db.execute("DELETE FROM registro WHERE id = ?", [dados[0]["id"]])
checar("apagar a ficha apaga as informações dela", db.execute("SELECT COUNT(*) FROM informacao").fetchone()[0] == 0)
dados = dados[1:]
filtrado = [r for r in dados if r["cidade"] == "Serra Modelo" and r["idade"] >= 30]
ordem = sorted(filtrado, key=lambda r: r["id"])
ordem.sort(key=lambda r: r["data"], reverse=True)
sql = "SELECT id FROM registro WHERE cidade = ? AND idade >= ? ORDER BY data DESC, id ASC LIMIT ? OFFSET ?"
checar("filtro, ordem e paginação", [x[0] for x in db.execute(sql, ["Serra Modelo", 30, 5, 0])] == [r["id"] for r in ordem[:5]])
sys.exit(1 if falhas else 0)
