"""Render the real dashboard DOM + compiled app CSS; validate saved print content."""
import argparse
import json
import logging
from copy import deepcopy
from io import BytesIO
from pathlib import Path

import pdfplumber
from pypdf import PdfReader
from weasyprint import HTML, CSS
from weasyprint.urls import URLFetcher
from weasyprint.text.fonts import FontConfiguration
from lxml import html

parser = argparse.ArgumentParser()
parser.add_argument("--html", required=True)
parser.add_argument("--css", required=True)
parser.add_argument("--fonts", required=True)
parser.add_argument("--expected", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--report", required=True)
args = parser.parse_args()
logging.getLogger("weasyprint").setLevel(logging.ERROR)
expected = json.loads(Path(args.expected).read_text())


local_only = URLFetcher(allowed_protocols={"file", "data"}, fail_on_errors=True)
fonts = FontConfiguration()


document = HTML(filename=args.html, url_fetcher=local_only).render(
    stylesheets=[CSS(filename=args.fonts, url_fetcher=local_only, font_config=fonts), CSS(filename=args.css, url_fetcher=local_only, font_config=fonts)],
    font_config=fonts,
)
document.write_pdf(args.output)
reader = PdfReader(args.output)
text = "\n".join(page.extract_text() or "" for page in reader.pages)
assert expected["title"] in text, "Saved meeting title missing from PDF"
assert expected["date"] in text, "Saved calendar date missing from PDF"
positions = [text.index(title) for title in expected["articleTitles"]]
assert positions == sorted(positions), "PDF article order differs from saved screen order"
assert text.count(expected["title"]) == 1, "Meeting document repeated during pagination"
assert all(text.count(title) == 1 for title in expected["articleTitles"]), "Article repeated during pagination"
for label in ["Save meeting details", "Discard changes", "Move up", "Move down", "Current signals", "My account"]:
    assert label not in text, f"Screen-only control leaked into PDF: {label}"
with pdfplumber.open(args.output) as pdf:
    for page in pdf.pages:
        assert page.chars, "Unexpected blank print page"
        assert all(-1 <= c["x0"] < c["x1"] <= page.width + 1 and -1 <= c["top"] < c["bottom"] <= page.height + 1 for c in page.chars), "Printed text outside page bounds"
report = {"renderer": "WeasyPrint with the actual React DOM and compiled application CSS", "pages": len(reader.pages),
          "savedTitleAndDateMatch": True, "manualArticleOrderMatches": True, "screenControlsHidden": True,
          "noBlankOrClippedPages": True, "browserDialog": "Not automated; local browser access is disabled."}
# Exercise pagination with 30 stories and a maximum-length meeting title.
stress = html.fromstring(Path(args.html).read_text())
listing = stress.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," missiondesk-print-list ")]')[0]
template = deepcopy(listing.find("article"))
for node in list(listing):
    listing.remove(node)
stress_titles = [f"Mexico meeting article for pagination {index:02d}" for index in range(1, 31)]
for title in stress_titles:
    article = deepcopy(template)
    article.xpath('.//h3/a')[0].text = title
    listing.append(article)
long_title = ((expected["title"] + " - monitoring, trade and meeting preparation ") * 4)[:160]
stress.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," missiondesk-print-title ")]')[0].text = long_title
stress_document = HTML(string=html.tostring(stress, encoding="unicode"), url_fetcher=local_only).render(
    stylesheets=[CSS(filename=args.fonts, url_fetcher=local_only, font_config=fonts), CSS(filename=args.css, url_fetcher=local_only, font_config=fonts)],
    font_config=fonts,
)
stress_pdf = stress_document.write_pdf()
stress_reader = PdfReader(BytesIO(stress_pdf))
stress_text = "\n".join(page.extract_text() or "" for page in stress_reader.pages)
assert len(stress_reader.pages) > 1, "Long meeting document did not exercise page breaks"
stress_positions = [stress_text.index(title) for title in stress_titles]
assert stress_positions == sorted(stress_positions)
assert all(stress_text.count(title) == 1 for title in stress_titles), "Article repeated across print pages"
assert "".join(long_title.split()) in "".join(stress_text.split()), "Long title clipped during print"
with pdfplumber.open(BytesIO(stress_pdf)) as pdf:
    for page in pdf.pages:
        assert page.chars, "Unexpected blank page in long meeting document"
        assert all(-1 <= c["x0"] < c["x1"] <= page.width + 1 and -1 <= c["top"] < c["bottom"] <= page.height + 1 for c in page.chars)
report.update({"fullThirtyArticlePagination": True, "longTitlePreserved": True, "longDocumentPages": len(stress_reader.pages)})
Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
print("[verify:meeting-print] Actual meeting HTML/CSS PDF: title, date, saved article order, hidden controls and page bounds passed.")
