"""Carga: converte as tabelas tratadas no JSON consumido por docs/index.html."""
import json
from bisect import bisect_right
from pathlib import Path
from typing import Any

import pandas as pd
from prefect import task

from src.config import ARQUIVO_JSON_SAIDA, REDES

JANELA_HISTORICO = 4  # semanas exibidas no gráfico "Evolução nas últimas 4 semanas"


# --------------------------------------------------------------------------- #
# Conversões para tipos nativos (o json padrão não serializa NaN/NA/numpy)
# --------------------------------------------------------------------------- #
def _inteiro(valor: Any) -> int:
    return 0 if pd.isna(valor) else int(valor)


def _texto(valor: Any, padrao: str | None = None) -> str | None:
    return padrao if pd.isna(valor) else str(valor)


def _periodo(inicio: pd.Timestamp, fim: pd.Timestamp, curto: bool = False) -> str:
    """'16/03 a 22/03/2026' (completo) ou '16/03 a 22/03' (curto, para rótulos)."""
    return f"{inicio:%d/%m} a {fim:%d/%m}" if curto else f"{inicio:%d/%m} a {fim:%d/%m/%Y}"


# --------------------------------------------------------------------------- #
# Montagem do payload
# --------------------------------------------------------------------------- #
def _totais_por_semana(tabelas: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Soma das redes por semana: engagement, menções (postagens) e alcance."""
    redes = pd.concat([tabelas[aba] for aba in REDES.values()], ignore_index=True)
    return redes.groupby("semana")[["engagement_score", "mencoes", "alcance"]].sum()


def _canais_por_semana(tabelas: dict[str, pd.DataFrame]) -> dict[int, list[dict]]:
    """{semana: [{name, value}, ...]} na ordem das redes definida em REDES."""
    canais: dict[int, list[dict]] = {}
    for aba in REDES.values():
        for linha in tabelas[aba].itertuples(index=False):
            canais.setdefault(int(linha.semana), []).append(
                {"name": linha.rede_social, "value": _inteiro(linha.engagement_score)}
            )
    return canais


def _propostas_da_semana(df_semana: pd.DataFrame, eng_total: int) -> list[dict]:
    return [
        {
            "id": str(p.proposta),
            "description": _texto(p.ementa, padrao=str(p.proposta)),
            "status": _texto(p.situacao, padrao=""),
            "engagement": _inteiro(p.engagement_score),
            "posts": _inteiro(p.mencoes),
            "authors": _inteiro(p.autores_unicos),
            "reach": _inteiro(p.alcance),
            "share": round(_inteiro(p.engagement_score) / eng_total * 100, 1) if eng_total else 0.0,
            "summary": _texto(p.o_que_dizem),
            "mobilization": _texto(p.o_que_mobilizou),
            "sample": _texto(p.publicacao_representativa),
            "channels": [],
            "arguments": [],
        }
        for p in df_semana.itertuples(index=False)
    ]


def _montar_payload(tabelas: dict[str, pd.DataFrame]) -> dict[str, Any]:
    propostas = tabelas["propostas"]
    if propostas.empty:
        raise ValueError("Nenhuma proposta encontrada para estruturar o JSON.")

    totais = _totais_por_semana(tabelas)
    canais = _canais_por_semana(tabelas)
    semanas_totais = list(totais.index)
    # "Mediana anual": mediana do engajamento semanal de todas as semanas da base
    mediana = int(totais["engagement_score"].median())

    # período de cada semana (menor início / maior fim entre as propostas)
    periodos = propostas.groupby("semana").agg(ini=("data_inicio", "min"), fim=("data_fim", "max"))
    periodo = {int(s): _periodo(r.ini, r.fim) for s, r in periodos.iterrows()}
    periodo_curto = {int(s): _periodo(r.ini, r.fim, curto=True) for s, r in periodos.iterrows()}

    dados_semanas: dict[str, Any] = {}
    for semana, df_semana in propostas.groupby("semana"):
        semana = int(semana)
        t = totais.loc[semana] if semana in totais.index else None
        eng, posts, alcance = (0, 0, 0) if t is None else map(_inteiro, t)

        # gráfico: as últimas N semanas até a semana selecionada (inclusive)
        fim_janela = bisect_right(semanas_totais, semana)
        historico = [
            {
                "week": int(s),
                "value": _inteiro(totais.at[s, "engagement_score"]),
                "label": periodo_curto.get(int(s), f"{s}ª semana"),  # eixo do gráfico e seletor
                "range": periodo.get(int(s), ""),                    # detalhe da semana
            }
            for s in semanas_totais[max(0, fim_janela - JANELA_HISTORICO):fim_janela]
        ]

        dados_semanas[str(semana)] = {
            "edition": f"{semana}ª edição",
            "period": periodo[semana],
            "summary": f"Relatório das 5 propostas em maior destaque nas redes na {semana}ª semana.",
            "kpis": [
                {"label": "ENGAJAMENTO GERAL", "value": eng, "change": None, "foot": "Pontos na semana"},
                {"label": "POSTAGENS", "value": posts, "change": None, "foot": "Total coletado"},
                {"label": "ALCANCE ESTIMADO", "value": alcance, "change": None, "foot": "Pessoas impactadas"},
            ],
            "history": historico,
            "median": mediana,
            "channels": canais.get(semana, []),
            "topics": [],
            "proposals": _propostas_da_semana(df_semana, eng),
        }

    semanas = sorted(map(int, dados_semanas))
    return {
        "semana_padrao": str(semanas[-1]),
        "opcoes_semanas": [
            {"id": str(s), "rotulo": f"{s}ª semana", "periodo": periodo[s]} for s in reversed(semanas)
        ],
        "dados_semanas": dados_semanas,
    }


@task(name="Salvar JSON no Dashboard", log_prints=True)
def salvar_dados_json(tabelas: dict[str, pd.DataFrame], destino: Path = ARQUIVO_JSON_SAIDA) -> Path:
    """Gera o JSON do painel e o grava em docs/dados/ (pasta publicada no GitHub Pages)."""
    payload = _montar_payload(tabelas)

    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".tmp")  # escrita atômica: nunca deixa JSON pela metade
    temporario.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    temporario.replace(destino)

    print(f"JSON salvo em {destino} ({len(payload['dados_semanas'])} semanas).")
    return destino
