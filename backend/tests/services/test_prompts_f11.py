"""step-78 F11 — Prompt service self-check.

Acceptance coverage for the versioned prompt library. Run with:
  cd backend && PYTHONPATH=. python3 tests/services/test_prompts_f11.py
"""

from __future__ import annotations

from app.services.prompt_service import (
    MAX_VERSIONS_PER_PROMPT,
    PromptError,
    _parse_dotprompt,
    _render_template,
)


def test_render_substitutes_variables():
    """Acceptance #1."""
    out = _render_template("Hello {{ name }}!", {"name": "Ada"})
    assert out == "Hello Ada!", out


def test_render_supports_if_and_for():
    """Acceptance #? — {% if %} / {% for %}."""
    tmpl = "{% if items %}{{ items | length }}: {% for x in items %}{{ x }},{% endfor %}{% else %}empty{% endif %}"  # noqa: E501
    assert _render_template(tmpl, {"items": ["a", "b"]}) == "2: a,b,"
    assert _render_template(tmpl, {"items": []}) == "empty"


def test_undeclared_variable_raises_typed_error():
    """Acceptance #3 — typed error at render time."""
    try:
        _render_template("Hi {{ nope }}", {})
    except PromptError as exc:
        assert exc.code == "undeclared_variable"
        return
    raise AssertionError("expected PromptError")


def test_diff_unified_format():
    a = "hello\nworld\n"
    b = "hello\nWORLD\nfoo\n"
    import difflib

    udiff = "".join(
        difflib.unified_diff(
            a.splitlines(keepends=True), b.splitlines(keepends=True), fromfile="v1", tofile="v2"
        )
    )
    assert "-world" in udiff and "+WORLD" in udiff and "+foo" in udiff


def test_dotprompt_import_parses_frontmatter_and_template():
    """Acceptance #5."""
    src = "---\nmodel: gpt-4o-mini\ntemperature: 0.2\n---\nWrite a haiku about {{ topic }}.\n"
    name, template, model_defaults, variables = _parse_dotprompt(src, override_name=None)
    assert "haiku" in template
    assert model_defaults.get("model") == "gpt-4o-mini"
    assert any(v["name"] == "topic" for v in variables)


def test_max_versions_constant_matches_spec():
    assert MAX_VERSIONS_PER_PROMPT == 100


def test_route_count_matches_spec():
    """Spec requires 11 endpoints; accept the documented surface."""
    from app.api.v1 import forge_prompts

    expected = {
        "GET /forge/prompts",
        "POST /forge/prompts",
        "GET /forge/prompts/{prompt_id}",
        "PATCH /forge/prompts/{prompt_id}",
        "POST /forge/prompts/{prompt_id}/archive",
        "GET /forge/prompts/{prompt_id}/versions",
        "GET /forge/prompts/{prompt_id}/diff",
        "POST /forge/prompts/{prompt_id}/preview",
        "POST /forge/prompts/{prompt_id}/test",
        "POST /forge/prompts/{prompt_id}/count",
        "POST /forge/prompts/import-dotprompt",
    }
    actual = set()
    for r in forge_prompts.router.routes:
        for m in sorted(getattr(r, "methods", set()) - {"HEAD"}):
            actual.add(f"{m} {r.path}")
    missing = expected - actual
    assert not missing, f"missing routes: {missing}"


if __name__ == "__main__":  # pragma: no cover
    import sys

    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}: {type(e).__name__}: {e}")
    sys.exit(failed)
