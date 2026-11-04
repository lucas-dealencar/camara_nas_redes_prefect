import gspread
import pandas as pd
from prefect import task

from src.config import ABA_ORIGEM, CAMINHO_CREDENCIAIS, SPREADSHEET_ID


@task(
    name="Extrair Dados do Google Sheets",
    retries=3,
    retry_delay_seconds=10,
    log_prints=True,
)
def extrair_dados_sheets() -> pd.DataFrame:
    """Carrega os registros brutos da aba `dados` da planilha Semanal BW."""
    print(f"Conectando ao Google Sheets: {SPREADSHEET_ID}...")
    gc = gspread.service_account(filename=str(CAMINHO_CREDENCIAIS))
    worksheet = gc.open_by_key(SPREADSHEET_ID).worksheet(ABA_ORIGEM)

    # UNFORMATTED_VALUE: números chegam como número (independe do formato/locale
    # da célula) e datas como serial do Sheets (tratado na transformação).
    registros = worksheet.get_all_records(value_render_option="UNFORMATTED_VALUE")

    df = pd.DataFrame(registros)
    print(f"Coleta concluída: {df.shape[0]} linhas e {df.shape[1]} colunas.")
    return df
