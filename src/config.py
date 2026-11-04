import os
from pathlib import Path

# Raiz do projeto: .../camara_nas_redes_prefect
BASE_DIR = Path(__file__).resolve().parent.parent

# --- Google Sheets ---------------------------------------------------------- #
# Arquivo de credenciais da conta de serviço (NÃO versionar; está no .gitignore).
CAMINHO_CREDENCIAIS = BASE_DIR / "src" / "credentials.json"
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "1GD0nSyJbQQkikWKcAxAU-HK8D8xH2goPRsX7u6vx738")
ABA_ORIGEM = "dados"

# --- Front-end (GitHub Pages: branch main, pasta /docs) ---------------------- #
PASTA_SITE = BASE_DIR / "docs"
ARQUIVO_JSON_SAIDA = PASTA_SITE / "dados" / "dados_dashboard.json"

# --- Redes sociais ---------------------------------------------------------- #
# Nome na planilha (categoria "Origem") -> nome da tabela no molde.
# A ordem aqui é a ordem dos canais exibida no dashboard.
REDES = {
    "X (Twitter)": "x_twitter",
    "Facebook": "facebook",
    "Instagram": "instagram",
    "YouTube": "youtube",
    "Bluesky": "bluesky",
}
