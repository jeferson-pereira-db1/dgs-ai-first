"""
Script de teste automatizado de prompts — NovaTech Assistente de Atendimento
Exercício 1.2 — Tech Lead

Objetivo: dado um system prompt, um conjunto de casos de teste (test-cases.json)
e um LLM (simulado aqui via função stub), verificar se as respostas atendem
critérios básicos de qualidade.

Em produção, substituir _call_llm() pela chamada real ao Azure OpenAI.
"""

import json
import re
import os
from dataclasses import dataclass, field
from typing import Optional


SYSTEM_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "../system/novatech-assistant-v1.0.md")
TEST_CASES_PATH = os.path.join(os.path.dirname(__file__), "test-cases.json")

SOURCE_PATTERN = re.compile(r"(Conforme|conforme|POL-\d+|PROC-\d+|SLA-\d+|FAQ-\d+)", re.IGNORECASE)
FORBIDDEN_TERMS = [
    "Platinum",
    "Diamond",
    "VIP",
    "acredito que",
    "provavelmente",
    "não tenho certeza mas",
    "possivelmente",
]


@dataclass
class TestCase:
    id: str
    descricao: str
    pergunta: str
    chunks_injetados: list
    resposta_esperada_contem: list
    resposta_nao_deve_conter: list
    deve_citar_fonte: bool
    armadilha: str


@dataclass
class CheckResult:
    check_name: str
    passed: bool
    detail: str = ""


@dataclass
class TestResult:
    test_id: str
    descricao: str
    armadilha: str
    resposta: str
    checks: list = field(default_factory=list)

    @property
    def passed(self):
        return all(c.passed for c in self.checks)


def load_system_prompt() -> str:
    with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def load_test_cases() -> list:
    with open(TEST_CASES_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return [TestCase(**tc) for tc in raw]


def build_context(system_prompt: str, test_case: TestCase) -> str:
    """
    Monta o contexto completo para envio ao LLM, substituindo os placeholders
    do system prompt com os dados do caso de teste.
    Sugerido pelo GitHub Copilot e ajustado manualmente para incluir fallback
    de histórico vazio.
    """
    chunks_text = "\n\n".join(test_case.chunks_injetados)
    context = system_prompt \
        .replace("{{TIER_CLIENTE}}", "Gold") \
        .replace("{{ID_CHAMADO}}", "CHM-TEST-001") \
        .replace("{{NOME_ATENDENTE}}", "Atendente de Teste") \
        .replace("{{TIMESTAMP}}", "2026-06-09T10:00:00-03:00") \
        .replace("{{CHUNKS_RECUPERADOS}}", chunks_text) \
        .replace("{{HISTORICO_CONVERSA}}", "(sem histórico — início de sessão)") \
        .replace("{{PERGUNTA_ATUAL}}", test_case.pergunta)
    return context


def _call_llm(context: str) -> str:
    """
    Stub para chamada ao LLM. Em produção, substituir pela chamada real:

    from openai import AzureOpenAI
    client = AzureOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key=os.getenv("AZURE_OPENAI_KEY"),
        api_version="2024-02-01"
    )
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "system", "content": context}],
        temperature=0,
        max_tokens=500
    )
    return response.choices[0].message.content

    Para fins de demonstração do conceito, retorna uma resposta simulada.
    """
    # Simulação — em produção, esta função faz a chamada real ao Azure OpenAI
    return (
        "[RESPOSTA SIMULADA — substituir _call_llm() por chamada real ao Azure OpenAI] "
        "Conforme POL-001, seção 3.1, o prazo de devolução é de 7 dias úteis."
    )


def check_cita_fonte(resposta: str) -> CheckResult:
    """Verifica se a resposta contém citação de fonte reconhecível."""
    has_source = bool(SOURCE_PATTERN.search(resposta))
    return CheckResult(
        check_name="cita_fonte",
        passed=has_source,
        detail="Fonte encontrada" if has_source else "FALHA: resposta não cita fonte reconhecível"
    )


def check_contem_esperado(resposta: str, termos_esperados: list) -> CheckResult:
    """Verifica se a resposta contém os termos esperados."""
    resposta_lower = resposta.lower()
    faltando = [t for t in termos_esperados if t.lower() not in resposta_lower]
    passed = len(faltando) == 0
    return CheckResult(
        check_name="contem_termos_esperados",
        passed=passed,
        detail="OK" if passed else f"FALHA: termos ausentes: {faltando}"
    )


def check_nao_contem_proibido(resposta: str, termos_proibidos: list) -> CheckResult:
    """Verifica se a resposta não contém termos da blocklist."""
    resposta_lower = resposta.lower()
    encontrados = [t for t in termos_proibidos if t.lower() in resposta_lower]
    global_blocklist_found = [t for t in FORBIDDEN_TERMS if t.lower() in resposta_lower]
    todos = list(set(encontrados + global_blocklist_found))
    passed = len(todos) == 0
    return CheckResult(
        check_name="nao_contem_termos_proibidos",
        passed=passed,
        detail="OK" if passed else f"FALHA: termos proibidos encontrados: {todos}"
    )


def check_tamanho(resposta: str, max_tokens: int = 500) -> CheckResult:
    """Estimativa simplificada de tamanho (1 token ≈ 0.75 palavras)."""
    palavras = len(resposta.split())
    tokens_estimados = int(palavras / 0.75)
    passed = tokens_estimados <= max_tokens
    return CheckResult(
        check_name="tamanho_adequado",
        passed=passed,
        detail=f"~{tokens_estimados} tokens estimados (limite: {max_tokens})"
    )


def run_test(system_prompt: str, test_case: TestCase) -> TestResult:
    context = build_context(system_prompt, test_case)
    resposta = _call_llm(context)

    checks = []

    if test_case.deve_citar_fonte:
        checks.append(check_cita_fonte(resposta))

    checks.append(check_contem_esperado(resposta, test_case.resposta_esperada_contem))
    checks.append(check_nao_contem_proibido(resposta, test_case.resposta_nao_deve_conter))
    checks.append(check_tamanho(resposta))

    return TestResult(
        test_id=test_case.id,
        descricao=test_case.descricao,
        armadilha=test_case.armadilha,
        resposta=resposta,
        checks=checks
    )


def print_result(result: TestResult):
    status = "PASS" if result.passed else "FAIL"
    print(f"\n{'='*60}")
    print(f"[{status}] {result.test_id} — {result.descricao}")
    print(f"Armadilha: {result.armadilha}")
    print(f"Resposta: {result.resposta[:200]}{'...' if len(result.resposta) > 200 else ''}")
    for check in result.checks:
        icon = "✓" if check.passed else "✗"
        print(f"  {icon} {check.check_name}: {check.detail}")


def main():
    print("=== Suite de Testes — NovaTech Assistente de Atendimento ===")
    print(f"System prompt: {SYSTEM_PROMPT_PATH}")
    print(f"Casos de teste: {TEST_CASES_PATH}")

    system_prompt = load_system_prompt()
    test_cases = load_test_cases()

    results = [run_test(system_prompt, tc) for tc in test_cases]

    total = len(results)
    passed = sum(1 for r in results if r.passed)

    for result in results:
        print_result(result)

    print(f"\n{'='*60}")
    print(f"RESULTADO FINAL: {passed}/{total} testes passaram")

    if passed < total:
        print("\nTestes com falha:")
        for r in results:
            if not r.passed:
                print(f"  - {r.test_id}: {r.descricao}")

    return 0 if passed == total else 1


if __name__ == "__main__":
    exit(main())
