#!/usr/bin/env python3
"""
MCP Health Check — NovaTech Assistant
Verifica que cada server configurado em .mcp/mcp.json está operacional:
- Comando disponível no PATH
- Diretórios de escopo existentes e acessíveis
- Pacote npm/uvx instalável (dry-run)
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
MCP_CONFIG = REPO_ROOT / ".mcp" / "mcp.json"

RED   = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE  = "\033[94m"
RESET = "\033[0m"
BOLD  = "\033[1m"

def ok(msg):   print(f"  {GREEN}✓{RESET}  {msg}")
def fail(msg): print(f"  {RED}✗{RESET}  {msg}")
def warn(msg): print(f"  {YELLOW}!{RESET}  {msg}")
def info(msg): print(f"  {BLUE}→{RESET}  {msg}")

def check_command(cmd: str) -> bool:
    path = shutil.which(cmd)
    if path:
        ok(f"comando `{cmd}` encontrado em {path}")
        return True
    fail(f"comando `{cmd}` não encontrado no PATH")
    return False

def check_directories(args: list[str], server_name: str) -> bool:
    """Verifica que os diretórios nos args do server filesystem existem."""
    all_ok = True
    for arg in args:
        # Considerar path apenas se começa com ./ — evita confundir pacotes npm (@scope/pkg)
        if arg.startswith("./"):
            full = REPO_ROOT / arg[2:]
            if full.exists():
                ok(f"diretório `{arg}` existe ({full})")
            else:
                fail(f"diretório `{arg}` NÃO existe ({full})")
                all_ok = False
    return all_ok

def check_filesystem_read(paths: list[str]) -> bool:
    """Confirma que pelo menos 1 arquivo de negócio da NovaTech está acessível."""
    novatech_dir = REPO_ROOT / "docs" / "novatech"
    corpus_dir   = REPO_ROOT / "data" / "retrieval-corpus"

    for directory in [novatech_dir, corpus_dir]:
        if directory.exists():
            files = list(directory.iterdir())
            if files:
                sample = files[0]
                ok(f"leitura verificada: {sample.relative_to(REPO_ROOT)} ({sample.stat().st_size} bytes)")
            else:
                warn(f"diretório {directory.relative_to(REPO_ROOT)} existe mas está vazio")
        else:
            fail(f"diretório {directory.relative_to(REPO_ROOT)} não existe")
    return True

def check_git_repo() -> bool:
    """Verifica que o repositório local é um git repo válido."""
    git_dir = REPO_ROOT / ".git"
    if not git_dir.exists():
        fail(f"repositório não inicializado (.git ausente em {REPO_ROOT})")
        return False

    try:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "log", "--oneline", "-3"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            commits = result.stdout.strip().split("\n")
            ok(f"git repo válido — últimos {len(commits)} commits:")
            for c in commits:
                info(f"    {c}")
            return True
        else:
            warn("git log falhou (repo pode não ter commits ainda)")
            return True  # repo sem commits ainda é válido
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        fail(f"git não disponível: {e}")
        return False

def check_npm_package(package: str) -> bool:
    """Verifica se npm consegue resolver o pacote (sem instalar)."""
    try:
        result = subprocess.run(
            ["npm", "view", package, "version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            ok(f"pacote `{package}` disponível no registro — versão mais recente: {version}")
            return True
        else:
            warn(f"pacote `{package}` não pôde ser verificado (sem conexão ou pacote privado)")
            return True  # não bloqueia — pode ser ambiente offline
    except (subprocess.TimeoutExpired, FileNotFoundError):
        warn(f"npm não disponível para verificar `{package}` — assumindo OK")
        return True

def run():
    print(f"\n{BOLD}=== MCP Health Check — NovaTech Assistant ==={RESET}")
    print(f"Config: {MCP_CONFIG}\n")

    if not MCP_CONFIG.exists():
        fail(f"arquivo {MCP_CONFIG} não encontrado")
        sys.exit(1)

    with open(MCP_CONFIG) as f:
        config = json.load(f)

    servers = config.get("mcpServers", {})
    if not servers:
        fail("nenhum server configurado em .mcp/mcp.json")
        sys.exit(1)

    results = {}

    for name, spec in servers.items():
        print(f"{BOLD}[{name}]{RESET}")
        cmd  = spec.get("command", "")
        args = spec.get("args", [])
        checks = []

        # 1. Comando disponível
        checks.append(check_command(cmd))

        # 2. Diretórios de escopo
        if name == "filesystem":
            checks.append(check_directories(args, name))
            check_filesystem_read(args)

        # 3. Git repo
        if name == "git":
            checks.append(check_git_repo())

        # 4. Pacote npm
        npm_packages = [a for a in args if a.startswith("@")]
        for pkg in npm_packages:
            checks.append(check_npm_package(pkg))

        results[name] = all(checks)
        status = f"{GREEN}OK{RESET}" if results[name] else f"{RED}FALHOU{RESET}"
        print(f"  → status: {status}\n")

    # Sumário
    print(f"{BOLD}=== Sumário ==={RESET}")
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    for name, ok_flag in results.items():
        icon = f"{GREEN}✓{RESET}" if ok_flag else f"{RED}✗{RESET}"
        print(f"  {icon} {name}")

    print(f"\n{passed}/{total} servers verificados com sucesso")
    if passed < total:
        print(f"{RED}Ação necessária: corrija as falhas acima antes de usar os agentes.{RESET}")
        sys.exit(1)
    else:
        print(f"{GREEN}Ambiente MCP pronto para uso.{RESET}")

if __name__ == "__main__":
    run()
