"""Transforma a aba `dados` (formato "largo") nas 7 tabelas do molde Base_Dashboard_Camara."""
import pandas as pd
from prefect import task

from src.config import REDES

# Parlamentares sem "- PARTIDO/UF" no texto de Autor; o molde os preenche à mão.
OVERRIDES_PARTIDO_UF = {
    "Sen. Alessandro Vieira": ("MDB", "SE"),
    "Sen. Flávio Dino": ("PSB", "MA"),
}

# "... - PL/RO"  ou  "... (PTB/AL)"  no fim do texto
REGEX_PARTIDO_UF = r"[-(]\s*(?P<partido>[^/()\-]+?)\s*/\s*(?P<uf>[A-Z]{2})\s*\)?\s*$"

# Tag artificial: o nome da proposta traz um "00" isolado (PEC00/2026, PL 00/2026).
# Lookarounds: "00" não precedido nem seguido de dígito -> não pega PL 1009/2022,
# PL 100/2022 nem PL 1/2000, onde o "00" faz parte de um número maior.
REGEX_TAG_ARTIFICIAL = r"(?<!\d)00(?!\d)"

# Texto da aba métricas_da_semana (o molde usa "Contexto teste"; sem fonte real, fica vazio).
CONTEXTO_PADRAO = None

COLUNAS_DATA = ["data_inicio", "data_fim"]
COLUNAS_NUMERICAS = ["Menções", "Alcance", "Autores_unicos", "Engagement_Score"]
METRICAS = ["mencoes", "alcance", "autores_unicos", "engagement_score"]

COLUNAS_PROPOSTAS = [
    "proposta", "tipo_proposicao", "data_inicio", "data_fim", "semana", "categoria",
    "autor", "partido", "uf", "ementa", "situacao",
    "o_que_dizem", "o_que_mobilizou", "publicacao_representativa",
    "mencoes", "alcance", "autores_unicos", "engagement_score", "link",
]
COLUNAS_REDE = [
    "tipo_metrica", "data_inicio", "data_fim", "semana", "categoria",
    "rede_social", *METRICAS,
]
COLUNAS_METRICAS = ["semana", "contexto"]
ABAS_ESPERADAS = {
    "propostas": COLUNAS_PROPOSTAS,
    "métricas_da_semana": COLUNAS_METRICAS,
    **{aba: COLUNAS_REDE for aba in REDES.values()},
}

RENOMEAR = {
    "Semana": "semana", "Categoria": "categoria", "Autor": "autor", "Link": "link",
    "Ementa": "ementa", "Situação": "situacao", "Menções": "mencoes",
    "Alcance": "alcance", "Autores_unicos": "autores_unicos",
    "Engagement_Score": "engagement_score",
}


# --------------------------------------------------------------------------- #
# Limpeza
# --------------------------------------------------------------------------- #
def _normalizar_tipos(df: pd.DataFrame) -> pd.DataFrame:
    """O gspread devolve '' nas células vazias, datas como serial do Sheets
    (ou texto) e números possivelmente como texto."""
    df = df.replace("", pd.NA)

    for col in COLUNAS_DATA:
        serial = pd.to_numeric(df[col], errors="coerce")
        texto = df[col].where(serial.isna())
        iso = pd.to_datetime(texto, format="ISO8601", errors="coerce")  # 2026-03-16
        br = pd.to_datetime(texto.where(iso.isna()), format="%d/%m/%Y", errors="coerce")
        datas = pd.to_datetime(serial, unit="D", origin="1899-12-30").fillna(iso).fillna(br)
        df[col] = datas.dt.normalize()

    df[COLUNAS_NUMERICAS] = df[COLUNAS_NUMERICAS].apply(pd.to_numeric, errors="raise")
    return df


def _converter_semana(df: pd.DataFrame) -> pd.DataFrame:
    """'12ª' -> 12 (int64): a semana é o id que liga as tabelas."""
    numeros = df["Semana"].astype("string").str.extract(r"(\d+)", expand=False)
    if numeros.isna().any():
        raise ValueError(f"Valores de 'Semana' sem número: {df.loc[numeros.isna(), 'Semana'].unique()}")
    return df.assign(Semana=numeros.astype("int64"))


def _limpar_textos(df: pd.DataFrame) -> pd.DataFrame:
    """Remove espaços/quebras de linha nas pontas ('PEC 18/2025\\n', 'PL/RO ')."""
    df = df.copy()
    for col in df.select_dtypes(include=["object", "string"]).columns:
        df[col] = df[col].astype("string").str.strip().replace("", pd.NA)
    return df


# --------------------------------------------------------------------------- #
# Montagem das tabelas do molde
# --------------------------------------------------------------------------- #
def _montar_propostas(df: pd.DataFrame) -> pd.DataFrame:
    p = df[df["Categoria"] == "Proposta"].rename(columns=RENOMEAR).rename(columns={"Nome": "proposta"})

    artificiais = p["proposta"].str.contains(REGEX_TAG_ARTIFICIAL, regex=True, na=False)
    if artificiais.any():
        print(f"Tags artificiais removidas ({artificiais.sum()}): {sorted(p.loc[artificiais, 'proposta'].unique())}")
    p = p[~artificiais].copy()

    # "PL 1/2026" -> PL;  "EMC 1 PEC 221/2019" -> EMC
    p["tipo_proposicao"] = p["proposta"].str.split().str[0]

    p[["partido", "uf"]] = p["autor"].str.extract(REGEX_PARTIDO_UF)
    for autor, (partido, uf) in OVERRIDES_PARTIDO_UF.items():
        sem_partido = (p["autor"] == autor) & p["partido"].isna()
        p.loc[sem_partido, ["partido", "uf"]] = [partido, uf]

    # preenchidas à mão depois; não existem na origem
    for col in ["o_que_dizem", "o_que_mobilizou", "publicacao_representativa"]:
        p[col] = pd.Series(pd.NA, index=p.index, dtype="string")

    p["engagement_score"] = p["engagement_score"].astype("int64")
    # ordem do molde: semana crescente, engagement decrescente dentro da semana
    p = p.sort_values(["semana", "engagement_score"], ascending=[True, False], kind="stable")
    return p[COLUNAS_PROPOSTAS].reset_index(drop=True)


def _montar_redes(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    o = df[df["Categoria"] == "Origem"].rename(columns=RENOMEAR).rename(columns={"Nome": "rede_social"})

    desconhecidas = set(o["rede_social"]) - set(REDES)
    if desconhecidas:
        raise ValueError(f"Rede(s) sem tabela de destino: {desconhecidas}")

    o = o.assign(tipo_metrica="Resumo Semanal da Rede").astype({m: "int64" for m in METRICAS})
    o = o[COLUNAS_REDE].sort_values("semana", kind="stable")
    return {aba: o[o["rede_social"] == rede].reset_index(drop=True) for rede, aba in REDES.items()}


def _montar_metricas(semanas: pd.Series) -> pd.DataFrame:
    m = pd.DataFrame({"semana": sorted(semanas.unique())})
    m["contexto"] = pd.Series(CONTEXTO_PADRAO, index=m.index, dtype="string")
    return m[COLUNAS_METRICAS]


def _validar(tabelas: dict[str, pd.DataFrame]) -> None:
    """Falha cedo se o resultado fugir do molde."""
    for aba, colunas in ABAS_ESPERADAS.items():
        if aba not in tabelas or list(tabelas[aba].columns) != colunas:
            raise ValueError(f"[{aba}] ausente ou com colunas fora do molde")

    for aba in REDES.values():
        if tabelas[aba].empty:
            raise ValueError(f"[{aba}] sem nenhuma linha na planilha de origem")
        if tabelas[aba].duplicated("semana").any():
            raise ValueError(f"[{aba}] semana duplicada")

    for aba in ["propostas", *REDES.values()]:
        if tabelas[aba][["semana", *COLUNAS_DATA]].isna().any().any():
            raise ValueError(f"[{aba}] semana/data nula")


@task(name="Transformar Dados", log_prints=True)
def transformar_dados(dados: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Limpa os dados brutos e os separa nas tabelas do molde."""
    print("Iniciando a transformação dos dados brutos...")
    df = _limpar_textos(_converter_semana(_normalizar_tipos(dados)))

    tabelas = {
        "propostas": _montar_propostas(df),
        "métricas_da_semana": _montar_metricas(df["Semana"]),
        **_montar_redes(df),
    }
    _validar(tabelas)

    print("Transformação e validação concluídas.")
    for aba, t in tabelas.items():
        print(f" - {aba:20s} {t.shape}")
    return tabelas