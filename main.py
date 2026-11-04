"""Flow principal: coleta (Google Sheets) -> transformação -> carga (JSON) -> publicação (git push).

  python main.py                 executa uma vez agora (coleta, gera o JSON e publica)
  python main.py --sem-publicar  executa uma vez sem commit/push (teste local)
  python main.py --agendar       fica em execução e roda todo dia às 11:30 (Brasília)
"""
import argparse
from pathlib import Path

from prefect import flow
from prefect.schedules import Cron

from src.carga import salvar_dados_json
from src.coleta import extrair_dados_sheets
from src.publicacao import publicar_dados_git
from src.transformacao import transformar_dados

CRON_DIARIO = Cron("30 11 * * *", timezone="America/Sao_Paulo")


@flow(name="Atualizar Dashboard Câmara nas Redes", log_prints=True)
def atualizar_dashboard(publicar: bool = True) -> Path:
    dados = extrair_dados_sheets()
    tabelas = transformar_dados(dados)
    arquivo = salvar_dados_json(tabelas)
    if publicar:
        publicar_dados_git(arquivo)
    return arquivo


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument("--agendar", action="store_true", help="roda todo dia às 11:30 (Brasília)")
    grupo.add_argument("--sem-publicar", action="store_true", help="não faz commit/push")
    args = parser.parse_args()

    if args.agendar:
        atualizar_dashboard.serve(name="dashboard-diario-1130", schedule=CRON_DIARIO)
    else:
        atualizar_dashboard(publicar=not args.sem_publicar)
