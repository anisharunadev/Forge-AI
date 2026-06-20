"""
Architecture sub-agent (FORA-29 detector + FORA-39 publisher).

Public surface:

    # 2.2 — architecture-style detector (FORA-29)
    from agents.architecture.detector import detect_styles
    from agents.architecture.rationale import render_rationale
    report = detect_styles(graph_dict)             # pure function
    md     = render_rationale(report)              # markdown

    # 2.4 — architecture docs publisher (FORA-39)
    from agents.architecture.publisher import (
        build_publish_plan, publish_to_confluence, post_announcement,
        parse_artefacts, render_adr_index,
    )
"""

from .detector import StyleReport, StyleTag, detect_styles  # noqa: F401
from .rationale import render_rationale  # noqa: F401
from .schemas import ALL_STYLES, GraphSummary  # noqa: F401
from .publisher import (  # noqa: F401
    AdrRow,
    AnnouncementResult,
    Artefact,
    ConfluenceClient,
    Frontmatter,
    PageSpec,
    PublishPlan,
    PublishReport,
    PublishResult,
    SlackClient,
    build_publish_plan,
    parse_artefacts,
    parse_frontmatter,
    post_announcement,
    publish_to_confluence,
    render_adr_index,
    render_index,
    to_storage_format,
)
