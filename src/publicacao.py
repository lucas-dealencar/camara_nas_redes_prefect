"""Publicação: commita e envia ao GitHub apenas o JSON do dashboard (o Pages atualiza sozinho)."""
import subprocess
from datetime import datetime
from pathlib import Path

from prefect import task

from src.config import ARQUIVO_JSON_SAIDA, BASE_DIR


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    resultado = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if resultado.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} falhou:\n{resultado.stderr or resultado.stdout}")
    return resultado


@task(name="Publicar dados no GitHub", retries=2, retry_delay_seconds=30, log_prints=True)
def publicar_dados_git(arquivo: Path = ARQUIVO_JSON_SAIDA, repo: Path = BASE_DIR) -> bool:
    """Commita só `arquivo` (se mudou) e faz push. Devolve True se houve commit."""
    caminho = str(arquivo.resolve().relative_to(repo.resolve()))

    _git(repo, "add", "--", caminho)
    if _git(repo, "status", "--porcelain", "--", caminho).stdout.strip() == "":
        print("Dados sem alterações desde a última publicação; nada a enviar.")
        return False

    mensagem = f"chore: atualiza dados do dashboard ({datetime.now():%Y-%m-%d %H:%M})"
    _git(repo, "commit", "-m", mensagem, "--", caminho)  # só este arquivo, mesmo com outros staged
    _git(repo, "pull", "--rebase", "--autostash")
    _git(repo, "push")

    print(f"Dados publicados: {mensagem}")
    return True
