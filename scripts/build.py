#!/usr/bin/env python3
"""Extract 金融市场基础知识 EPUB into JSON + images for the local study site."""

from __future__ import annotations

import html
import json
import re
import shutil
import zipfile
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
IMAGES = PUBLIC / "images"
EPUB = Path(
    "/Users/admin/Downloads/金融市场基础知识 (《金融市场基础知识》编写组编) "
    "(z-library.sk, 1lib.sk, z-lib.sk).epub"
)
EXTRACT = ROOT / ".epub-extract"

NS_STRIP = re.compile(r"\{[^}]+\}")
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
STEM_NUM = re.compile(r"^(\d+)[\.．、]\s*(.+)$")
OPT_RE = re.compile(r"^([A-D])[\.．、]\s*(.*)$")
ITEM_RE = re.compile(r"^([ⅠⅡⅢⅣⅤ])[\.．、]\s*(.*)$")
ZHENTI_RE = re.compile(r"^【真题([^】]+)】\s*(.*)$")
ANSWER_RE = re.compile(r"^(?:(\d+)[\.．])?【答案】\s*([A-Da-d]+)")
EXPLAIN_RE = re.compile(r"^【解析】\s*(.*)$")
LEVEL_RE = re.compile(r"（(掌握|熟悉|了解)）")
OUTLINE_ITEM_RE = re.compile(r"(掌握|熟悉|了解)([^；;。]+)")
HEADING_LEVEL = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}

CHAPTER_FILE_MAP = {
    "chapter1.xhtml": "guide",
    "chapter2.xhtml": "lecture",
    "chapter3.xhtml": "true",
    "chapter4.xhtml": "mock",
    "chapter5.xhtml": "answers",
}


def strip_tags(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = TAG_RE.sub("", s)
    s = html.unescape(s)
    s = s.replace("\xa0", " ").replace("　　", " ")
    return WS_RE.sub(" ", s).strip()


def rewrite_html(inner: str) -> str:
    inner = re.sub(
        r'src="\.\./Images/([^"]+)"',
        r'src="images/\1"',
        inner,
    )
    inner = re.sub(r'href="\.\./Text/toc\.xhtml#[^"]+"', "", inner)
    inner = re.sub(r"<a\s+>(.*?)</a>", r"\1", inner, flags=re.S)
    inner = re.sub(r"<a>(.*?)</a>", r"\1", inner, flags=re.S)
    return inner.strip()


class BlockParser(HTMLParser):
    BLOCK_TAGS = {"h1", "h2", "h3", "h4", "p", "div"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self._stack: list[str] = []
        self._cur: dict | None = None
        self._parts: list[str] = []
        self._in_block = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        ad = {k: (v or "") for k, v in attrs}
        self._stack.append(tag)
        if tag in self.BLOCK_TAGS and self._in_block == 0:
            self._flush()
            self._cur = {
                "tag": tag,
                "id": ad.get("id", ""),
                "class": ad.get("class", ""),
                "html": "",
                "text": "",
            }
            self._parts = []
            self._in_block = 1
            if tag in HEADING_LEVEL:
                return
            if tag == "div":
                return
            return
        if self._cur is not None:
            if tag == "img":
                src = ad.get("src", "")
                src = re.sub(r"^\.\./Images/", "images/", src)
                alt = ad.get("alt", "")
                cls = ad.get("class", "")
                self._parts.append(
                    f'<img src="{html.escape(src)}" alt="{html.escape(alt)}" class="{html.escape(cls)}">'
                )
            elif tag == "br":
                self._parts.append("<br>")
            elif tag in {"em", "sub", "sup", "strong", "span"}:
                extra = ""
                if ad.get("class"):
                    extra = f' class="{html.escape(ad["class"])}"'
                self._parts.append(f"<{tag}{extra}>")
            elif tag == "a":
                self._parts.append("<span>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._stack:
            self._stack.pop()
        if self._cur is not None and tag in {"em", "sub", "sup", "strong", "span"}:
            self._parts.append(f"</{tag}>")
        elif self._cur is not None and tag == "a":
            self._parts.append("</span>")
        if tag in self.BLOCK_TAGS and self._in_block and self._cur and self._cur["tag"] == tag:
            self._flush()
            self._in_block = 0

    def handle_data(self, data: str) -> None:
        if self._cur is not None:
            self._parts.append(html.escape(data))

    def _flush(self) -> None:
        if not self._cur:
            return
        raw = "".join(self._parts)
        text = strip_tags(raw)
        self._cur["html"] = raw.strip()
        self._cur["text"] = text
        if text or "<img" in raw:
            self.blocks.append(self._cur)
        self._cur = None
        self._parts = []

    def close(self) -> None:
        self._flush()
        super().close()


def parse_blocks(xhtml: str) -> list[dict]:
    body_m = re.search(r"<body[^>]*>(.*)</body>", xhtml, re.S | re.I)
    body = body_m.group(1) if body_m else xhtml
    p = BlockParser()
    p.feed(body)
    p.close()
    return p.blocks


def looks_like_stem(text: str) -> bool:
    if ZHENTI_RE.match(text):
        return True
    m = STEM_NUM.match(text)
    if not m:
        return False
    rest = m.group(2)
    return "（" in rest or "(" in rest or "（　" in rest or "（ " in rest


def parse_question_stream(paras: list[str], source: str, default_kind: str = "single") -> list[dict]:
    questions: list[dict] = []
    kind = default_kind
    cur: dict | None = None
    explain_mode = False

    def flush() -> None:
        nonlocal cur, explain_mode
        if cur and cur.get("stem"):
            if not cur.get("options"):
                cur["options"] = []
            questions.append(cur)
        cur = None
        explain_mode = False

    for raw in paras:
        text = raw.strip()
        if not text:
            continue
        if re.match(r"^一、", text) and "选择" in text:
            flush()
            kind = "single"
            continue
        if re.match(r"^二、", text) and ("组合" in text or "选择" in text):
            flush()
            kind = "combo"
            continue
        am = ANSWER_RE.match(text)
        if am and cur:
            cur["answer"] = am.group(2).upper()
            rest = text[am.end() :].strip()
            if rest:
                cur["explain"] = (cur.get("explain") or "") + rest
            explain_mode = False
            continue
        if text.startswith("【答案】") and cur:
            cur["answer"] = text.replace("【答案】", "").strip().upper()
            explain_mode = False
            continue
        em = EXPLAIN_RE.match(text)
        if em and cur:
            cur["explain"] = em.group(1)
            explain_mode = True
            continue
        zm = ZHENTI_RE.match(text)
        if zm:
            flush()
            cur = {
                "stem": zm.group(2).strip(),
                "label": zm.group(1),
                "kind": "combo" if "Ⅰ" in zm.group(2) or "Ⅰ" in text else "single",
                "options": [],
                "items": [],
                "answer": "",
                "explain": "",
                "source": source,
                "inline": True,
            }
            continue
        if OPT_RE.match(text) and cur:
            om = OPT_RE.match(text)
            cur["options"].append({"key": om.group(1), "text": om.group(2)})
            if "Ⅰ" in om.group(2) or "Ⅰ" in "".join(x["text"] for x in cur["options"]):
                if cur["kind"] == "single" and cur.get("items"):
                    cur["kind"] = "combo"
            explain_mode = False
            continue
        if ITEM_RE.match(text) and cur:
            im = ITEM_RE.match(text)
            cur["items"].append({"key": im.group(1), "text": im.group(2)})
            cur["kind"] = "combo"
            continue
        if looks_like_stem(text) and not text.startswith("【"):
            flush()
            sm = STEM_NUM.match(text)
            cur = {
                "stem": sm.group(2) if sm else text,
                "number": int(sm.group(1)) if sm else 0,
                "label": sm.group(1) if sm else "",
                "kind": kind,
                "options": [],
                "items": [],
                "answer": "",
                "explain": "",
                "source": source,
                "inline": False,
            }
            continue
        if cur and explain_mode:
            cur["explain"] = (cur.get("explain") or "") + text
            continue
        if cur and not cur["options"] and not cur["items"]:
            cur["stem"] = (cur["stem"] + text).strip()
            continue
        if cur and cur.get("explain") is not None and cur.get("answer") and not cur["options"]:
            cur["explain"] = (cur.get("explain") or "") + text
    flush()
    # combo detection: options contain roman numerals
    for q in questions:
        joined = " ".join(o["text"] for o in q.get("options", []))
        if q.get("items") or "Ⅰ" in joined or "Ⅱ" in joined:
            q["kind"] = "combo"
        if len(q.get("options", [])) == 4:
            keys = [o["key"] for o in q["options"]]
            if keys != ["A", "B", "C", "D"]:
                # still keep
                pass
    return [q for q in questions if len(q.get("options", [])) >= 2]


def extract_outline_items(text: str, section_id: str, chapter_id: str) -> list[dict]:
    items = []
    for level, body in OUTLINE_ITEM_RE.findall(text):
        body = body.strip(" ：:，,")
        if 2 <= len(body) <= 80:
            items.append(
                {
                    "id": f"ol-{section_id}-{len(items)}",
                    "level": level,
                    "text": body,
                    "sectionId": section_id,
                    "chapterId": chapter_id,
                }
            )
    return items


def extract_epub() -> Path:
    EXTRACT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(EPUB) as z:
        z.extractall(EXTRACT)
    return EXTRACT / "OEBPS"


def copy_images(oebps: Path) -> None:
    src = oebps / "Images"
    IMAGES.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        return
    for p in src.iterdir():
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif"}:
            dest = IMAGES / p.name
            if not dest.exists() or dest.stat().st_size != p.stat().st_size:
                shutil.copy2(p, dest)


def build() -> dict:
    oebps = extract_epub()
    copy_images(oebps)
    DATA.mkdir(parents=True, exist_ok=True)

    text_dir = oebps / "Text"
    files = {
        "guide": (text_dir / "chapter1.xhtml").read_text(encoding="utf-8"),
        "lecture": (text_dir / "chapter2.xhtml").read_text(encoding="utf-8"),
        "true": (text_dir / "chapter3.xhtml").read_text(encoding="utf-8"),
        "mock": (text_dir / "chapter4.xhtml").read_text(encoding="utf-8"),
        "answers": (text_dir / "chapter5.xhtml").read_text(encoding="utf-8"),
        "preface": (text_dir / "preface.xhtml").read_text(encoding="utf-8"),
        "abstract": (text_dir / "copyright2.xhtml").read_text(encoding="utf-8"),
    }

    blocks = {k: parse_blocks(v) for k, v in files.items()}

    chapters: list[dict] = []
    sections: list[dict] = []
    questions: list[dict] = []
    outlines: list[dict] = []
    qid_n = 0

    def next_qid(prefix: str) -> str:
        nonlocal qid_n
        qid_n += 1
        return f"{prefix}-{qid_n:04d}"

    # ----- 备考指南 -----
    guide_ch = {
        "id": "guide",
        "part": "备考指南",
        "index": 0,
        "title": "备考指南",
        "kind": "guide",
        "sectionIds": [],
        "questionIds": [],
        "mindmap": None,
    }
    cur_sec = None
    guide_paras_by_sec: dict[str, list[str]] = defaultdict(list)
    for b in blocks["guide"]:
        if b["tag"] in HEADING_LEVEL:
            if cur_sec:
                sections.append(cur_sec)
            sid = b["id"] or f"g-{len(sections)}"
            cur_sec = {
                "id": sid,
                "chapterId": "guide",
                "title": b["text"] or strip_tags(b["html"]),
                "level": HEADING_LEVEL[b["tag"]],
                "html": f"<{b['tag']}>{b['html']}</{b['tag']}>",
                "text": b["text"],
                "kind": "heading",
            }
            guide_ch["sectionIds"].append(sid)
        elif cur_sec:
            if b["tag"] == "div" and "<img" in b["html"]:
                cur_sec["html"] += f'<figure class="fig">{b["html"]}</figure>'
            elif b.get("class") == "imgnote-c":
                cur_sec["html"] += f'<p class="imgnote">{b["html"]}</p>'
            else:
                cur_sec["html"] += f"<p>{b['html']}</p>"
            cur_sec["text"] += "\n" + b["text"]
            guide_paras_by_sec[cur_sec["id"]].append(b["text"])
    if cur_sec:
        sections.append(cur_sec)
    chapters.append(guide_ch)

    # inline 真题 in 备考指南
    for sid, paras in guide_paras_by_sec.items():
        qs = parse_question_stream(paras, f"guide:{sid}")
        for q in qs:
            qid = next_qid("q")
            q["id"] = qid
            q["chapterId"] = "guide"
            q["sectionId"] = sid
            q["bank"] = "inline"
            questions.append(q)
            guide_ch["questionIds"].append(qid)

    # ----- 名师讲义 6 chapters -----
    lecture_chapters: list[dict] = []
    current_chapter = None
    current_section = None
    current_h3_kind = ""
    drill_mode = False
    drill_paras: list[str] = []
    lecture_sec_paras: dict[str, list[str]] = defaultdict(list)

    def close_section() -> None:
        nonlocal current_section
        if current_section:
            sections.append(current_section)
            current_section = None

    def attach_drill(ch: dict, paras: list[str]) -> None:
        qs = parse_question_stream(paras, f"drill:{ch['id']}", default_kind="single")
        for q in qs:
            qid = next_qid("q")
            q["id"] = qid
            q["chapterId"] = ch["id"]
            q["sectionId"] = None
            q["bank"] = "drill"
            q["inline"] = False
            questions.append(q)
            ch["questionIds"].append(qid)

    for b in blocks["lecture"]:
        text = b["text"]
        if b["tag"] == "h1":
            continue
        if b["tag"] == "h2":
            close_section()
            if drill_mode and current_chapter and drill_paras:
                attach_drill(current_chapter, drill_paras)
            drill_mode = False
            drill_paras = []
            cid = f"lec-{len(lecture_chapters)+1}"
            current_chapter = {
                "id": cid,
                "part": "名师讲义",
                "index": len(lecture_chapters) + 1,
                "title": text,
                "kind": "lecture",
                "sectionIds": [],
                "questionIds": [],
                "mindmap": None,
            }
            lecture_chapters.append(current_chapter)
            chapters.append(current_chapter)
            current_h3_kind = ""
            continue
        if current_chapter is None:
            continue
        if b["tag"] == "h3":
            close_section()
            if "过关演练" in text:
                if drill_mode and drill_paras:
                    attach_drill(current_chapter, drill_paras)
                drill_mode = True
                drill_paras = []
                current_h3_kind = "drill"
            elif "思维导图" in text:
                drill_mode = False
                current_h3_kind = "mindmap"
            elif text == "考纲要求":
                drill_mode = False
                current_h3_kind = "outline"
            elif text == "名师讲义":
                drill_mode = False
                current_h3_kind = "lecture"
            else:
                drill_mode = False
                current_h3_kind = "section"
            sid = b["id"] or f"{current_chapter['id']}-h3-{len(sections)}"
            current_section = {
                "id": sid,
                "chapterId": current_chapter["id"],
                "title": text,
                "level": 3,
                "html": f"<h3>{html.escape(text)}</h3>",
                "text": text,
                "kind": current_h3_kind or "section",
            }
            current_chapter["sectionIds"].append(sid)
            continue
        if b["tag"] == "h4":
            close_section()
            drill_mode = False
            sid = b["id"] or f"{current_chapter['id']}-h4-{len(sections)}"
            lv = None
            m = LEVEL_RE.search(text)
            if m:
                lv = m.group(1)
            current_section = {
                "id": sid,
                "chapterId": current_chapter["id"],
                "title": text,
                "level": 4,
                "html": f"<h4>{html.escape(text)}</h4>",
                "text": text,
                "kind": "topic",
                "examLevel": lv,
            }
            current_chapter["sectionIds"].append(sid)
            continue
        if drill_mode:
            drill_paras.append(text)
            if current_section:
                if b["tag"] == "div" and "<img" in b["html"]:
                    current_section["html"] += f'<figure class="fig">{b["html"]}</figure>'
                else:
                    current_section["html"] += f"<p>{b['html']}</p>"
                current_section["text"] += "\n" + text
            continue
        if current_section is None:
            sid = f"{current_chapter['id']}-body-{len(sections)}"
            current_section = {
                "id": sid,
                "chapterId": current_chapter["id"],
                "title": current_chapter["title"],
                "level": 3,
                "html": "",
                "text": "",
                "kind": "section",
            }
            current_chapter["sectionIds"].append(sid)
        if b["tag"] == "div" and "<img" in b["html"]:
            img_m = re.search(r'src="([^"]+)"', b["html"])
            src = img_m.group(1) if img_m else ""
            src = re.sub(r"^\.\./Images/", "images/", src)
            current_section["html"] += f'<figure class="fig"><img src="{src}" alt=""></figure>'
            if current_section["kind"] == "mindmap" and not current_chapter.get("mindmap"):
                current_chapter["mindmap"] = src
            continue
        if b.get("class") == "imgnote-c":
            current_section["html"] += f'<p class="imgnote">{b["html"]}</p>'
            continue
        # highlight exam levels in paragraphs
        para_html = b["html"]
        para_html = LEVEL_RE.sub(
            lambda m: f'<span class="lv lv-{ {"掌握":"master","熟悉":"familiar","了解":"know"}[m.group(1)] }">{m.group(0)}</span>',
            para_html,
        )
        current_section["html"] += f"<p>{para_html}</p>"
        current_section["text"] += "\n" + text
        lecture_sec_paras[current_section["id"]].append(text)
        if current_section["kind"] == "outline":
            outlines.extend(
                extract_outline_items(text, current_section["id"], current_chapter["id"])
            )
        else:
            # also pick （掌握） headings inside paragraphs like （一）xxx（掌握）
            if LEVEL_RE.search(text) and len(text) < 80:
                lv = LEVEL_RE.search(text).group(1)
                body = LEVEL_RE.sub("", text)
                body = re.sub(r"^[（(][一二三四五六七八九十0-9]+[）)]", "", body).strip(" ．.、")
                if body:
                    outlines.append(
                        {
                            "id": f"ol-{current_section['id']}-{len(outlines)}",
                            "level": lv,
                            "text": body,
                            "sectionId": current_section["id"],
                            "chapterId": current_chapter["id"],
                        }
                    )

    close_section()
    if drill_mode and current_chapter and drill_paras:
        attach_drill(current_chapter, drill_paras)

    # inline 真题 from lecture sections
    for sid, paras in lecture_sec_paras.items():
        qs = parse_question_stream(paras, f"inline:{sid}")
        ch_id = next((s["chapterId"] for s in sections if s["id"] == sid), None)
        ch = next((c for c in chapters if c["id"] == ch_id), None)
        for q in qs:
            qid = next_qid("q")
            q["id"] = qid
            q["chapterId"] = ch_id
            q["sectionId"] = sid
            q["bank"] = "inline"
            questions.append(q)
            if ch:
                ch["questionIds"].append(qid)

    # ----- papers -----
    def parse_papers(block_list: list[dict], bank: str, part_title: str) -> None:
        papers: list[dict] = []
        cur = None
        paras: list[str] = []
        html_acc = ""
        for b in block_list:
            if b["tag"] == "h1":
                continue
            if b["tag"] == "h2":
                if cur is not None:
                    qs = parse_question_stream(paras, f"{bank}:{cur['id']}")
                    for q in qs:
                        qid = next_qid("q")
                        q["id"] = qid
                        q["chapterId"] = cur["id"]
                        q["sectionId"] = None
                        q["bank"] = bank
                        questions.append(q)
                        cur["questionIds"].append(qid)
                    sid = f"{cur['id']}-paper"
                    sections.append(
                        {
                            "id": sid,
                            "chapterId": cur["id"],
                            "title": cur["title"],
                            "level": 2,
                            "html": html_acc,
                            "text": "\n".join(paras),
                            "kind": "paper",
                        }
                    )
                    cur["sectionIds"].append(sid)
                    papers.append(cur)
                    chapters.append(cur)
                cid = f"{bank}-{len(papers)+1}"
                cur = {
                    "id": cid,
                    "part": part_title,
                    "index": len(papers) + 1,
                    "title": b["text"],
                    "kind": bank,
                    "sectionIds": [],
                    "questionIds": [],
                    "mindmap": None,
                    "timed": True,
                    "minutes": 120,
                    "total": 100,
                }
                paras = []
                html_acc = f"<h2>{html.escape(b['text'])}</h2>"
                continue
            if cur is None:
                continue
            paras.append(b["text"])
            html_acc += f"<p>{b['html']}</p>"
        if cur is not None:
            qs = parse_question_stream(paras, f"{bank}:{cur['id']}")
            for q in qs:
                qid = next_qid("q")
                q["id"] = qid
                q["chapterId"] = cur["id"]
                q["sectionId"] = None
                q["bank"] = bank
                questions.append(q)
                cur["questionIds"].append(qid)
            sid = f"{cur['id']}-paper"
            sections.append(
                {
                    "id": sid,
                    "chapterId": cur["id"],
                    "title": cur["title"],
                    "level": 2,
                    "html": html_acc,
                    "text": "\n".join(paras),
                    "kind": "paper",
                }
            )
            cur["sectionIds"].append(sid)
            papers.append(cur)
            chapters.append(cur)

    parse_papers(blocks["true"], "true", "历年真题")
    parse_papers(blocks["mock"], "mock", "模拟试题")

    # ----- answers for drills / papers -----
    ans_blocks = blocks["answers"]
    # Structure:
    # h2 各章过关演练答案与解析
    # p.text-ht-c 第一章
    # p 一、选择题
    # p 1.【答案】B
    # p 【解析】...
    ans_index: dict[tuple, dict] = {}
    mode = None  # drill / true / mock
    chapter_no = 0
    paper_no = 0
    kind = "single"
    pending_num = None
    pending = None

    def store_ans() -> None:
        nonlocal pending
        if pending and pending.get("num") and pending.get("answer"):
            key = (mode, chapter_no if mode == "drill" else paper_no, kind, pending["num"])
            ans_index[key] = pending
        pending = None

    for b in ans_blocks:
        t = b["text"]
        if b["tag"] == "h2":
            store_ans()
            if "过关演练" in t:
                mode = "drill"
                chapter_no = 0
                paper_no = 0
            elif "历年真题" in t:
                mode = "true"
                paper_no = 0
            elif "模拟" in t:
                mode = "mock"
                paper_no = 0
            continue
        if b.get("class") in {"text-ht-c", "text-ht"} or (
            t in {f"第{x}章" for x in "一二三四五六"} or "真题答案" in t or "模拟试题" in t
        ):
            store_ans()
            if t.startswith("第") and t.endswith("章"):
                cmap = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6}
                chapter_no = cmap.get(t[1], chapter_no)
            elif "（一）" in t or t.endswith("（一）"):
                paper_no = 1
            elif "（二）" in t or t.endswith("（二）"):
                paper_no = 2
            continue
        if re.match(r"^一、", t) and "选择" in t:
            store_ans()
            kind = "single"
            continue
        if re.match(r"^二、", t):
            store_ans()
            kind = "combo"
            continue
        am = ANSWER_RE.match(t)
        if am:
            store_ans()
            pending = {
                "num": int(am.group(1) or 0),
                "answer": am.group(2).upper(),
                "explain": t[am.end() :].strip(),
            }
            continue
        em = EXPLAIN_RE.match(t)
        if em and pending:
            pending["explain"] = (pending.get("explain") or "") + em.group(1)
            continue
        if pending and pending.get("answer"):
            pending["explain"] = (pending.get("explain") or "") + t

    store_ans()

    # attach answers to drill/true/mock questions
    by_bank: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        by_bank[q["bank"]].append(q)

    def apply_answers(bank: str, mode_key: str) -> None:
        groups: dict[str, list[dict]] = defaultdict(list)
        for q in by_bank.get(bank, []):
            groups[q["chapterId"]].append(q)
        for ch_id, qs in groups.items():
            ch = next((c for c in chapters if c["id"] == ch_id), None)
            if not ch:
                continue
            if bank == "drill":
                chap_n = ch["index"]
                paper_n = 0
            else:
                chap_n = 0
                paper_n = ch["index"]
            buckets = {"single": [], "combo": []}
            for q in qs:
                buckets[q["kind"] if q["kind"] in buckets else "single"].append(q)
            for knd, lst in buckets.items():
                lst.sort(key=lambda x: x.get("number") or 0)
                for i, q in enumerate(lst, 1):
                    num = q.get("number") or i
                    key = (mode_key, chap_n if bank == "drill" else paper_n, knd, num)
                    info = ans_index.get(key)
                    if not info:
                        # try other kind
                        other = "combo" if knd == "single" else "single"
                        info = ans_index.get((mode_key, chap_n if bank == "drill" else paper_n, other, num))
                    if info:
                        if not q.get("answer"):
                            q["answer"] = info["answer"]
                        if info.get("explain"):
                            q["explain"] = info["explain"]

    apply_answers("drill", "drill")
    apply_answers("true", "true")
    apply_answers("mock", "mock")

    # flashcards from outlines + topic sections
    cards = []
    seen = set()
    for ol in outlines:
        key = (ol["chapterId"], ol["text"])
        if key in seen:
            continue
        seen.add(key)
        sec = next((s for s in sections if s["id"] == ol["sectionId"]), None)
        back = ""
        if sec:
            # take following topic section body if this is outline
            if sec["kind"] == "outline":
                # find next topic sections in same chapter until next outline/section
                ch = next(c for c in chapters if c["id"] == ol["chapterId"])
                take = []
                started = False
                for sid in ch["sectionIds"]:
                    s = next(x for x in sections if x["id"] == sid)
                    if s["id"] == sec["id"]:
                        started = True
                        continue
                    if not started:
                        continue
                    if s["kind"] in {"outline", "section", "drill", "mindmap"} and s["level"] == 3 and s["kind"] != "topic":
                        if s["kind"] != "lecture" and s["kind"] != "topic":
                            if s["kind"] in {"outline", "section", "drill", "mindmap"} and "考纲" not in s["title"] and s["kind"] != "lecture":
                                if s["kind"] != "lecture":
                                    break
                    if s["kind"] == "topic" and ol["text"][:4] in s["title"]:
                        take = [s]
                        break
                    if s["kind"] == "topic":
                        take.append(s)
                        if len(take) >= 2:
                            break
                if take:
                    back = "\n".join(strip_tags(t["text"])[:400] for t in take[:1])
            else:
                back = strip_tags(sec["text"])[:500]
        cards.append(
            {
                "id": f"card-{len(cards)+1:03d}",
                "level": ol["level"],
                "front": ol["text"],
                "back": back or ol["text"],
                "chapterId": ol["chapterId"],
                "sectionId": ol["sectionId"],
            }
        )

    # extra cards from topic titles
    for s in sections:
        if s.get("kind") == "topic":
            title = LEVEL_RE.sub("", s["title"])
            title = re.sub(r"^[一二三四五六七八九十]+、", "", title).strip()
            key = (s["chapterId"], title)
            if title and key not in seen:
                seen.add(key)
                lv = s.get("examLevel") or "熟悉"
                cards.append(
                    {
                        "id": f"card-{len(cards)+1:03d}",
                        "level": lv,
                        "front": title,
                        "back": strip_tags(s["text"])[:600],
                        "chapterId": s["chapterId"],
                        "sectionId": s["id"],
                    }
                )

    # search index (compact)
    search_docs = []
    for s in sections:
        if s["kind"] in {"paper", "drill"}:
            continue
        snippet = strip_tags(s["text"])[:180]
        if len(snippet) < 8:
            continue
        search_docs.append(
            {
                "id": s["id"],
                "type": "section",
                "title": s["title"],
                "chapterId": s["chapterId"],
                "snippet": snippet,
                "text": strip_tags(s["text"])[:1200],
            }
        )
    for q in questions:
        search_docs.append(
            {
                "id": q["id"],
                "type": "question",
                "title": q["stem"][:80],
                "chapterId": q.get("chapterId"),
                "snippet": q["stem"][:180],
                "text": q["stem"] + " " + " ".join(o["text"] for o in q.get("options", [])),
            }
        )

    # stats
    answered_q = sum(1 for q in questions if q.get("answer"))
    meta = {
        "title": "金融市场基础知识",
        "subtitle": "证券业从业人员一般从业资格考试 · 私人学馆",
        "authors": "《金融市场基础知识》编写组",
        "isbn": "9787115443663",
        "notice": "仅供个人本地学习使用，请勿传播。",
        "stats": {
            "chapters": len([c for c in chapters if c["kind"] == "lecture"]),
            "sections": len(sections),
            "questions": len(questions),
            "questionsWithAnswer": answered_q,
            "outlines": len(outlines),
            "cards": len(cards),
        },
    }

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA / "chapters.json").write_text(json.dumps(chapters, ensure_ascii=False), encoding="utf-8")
    (DATA / "sections.json").write_text(json.dumps(sections, ensure_ascii=False), encoding="utf-8")
    (DATA / "questions.json").write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")
    (DATA / "outlines.json").write_text(json.dumps(outlines, ensure_ascii=False), encoding="utf-8")
    (DATA / "cards.json").write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
    (DATA / "search.json").write_text(json.dumps(search_docs, ensure_ascii=False), encoding="utf-8")

    # report
    print("chapters", [(c["id"], c["title"], len(c["questionIds"])) for c in chapters])
    print("sections", len(sections))
    print("questions", len(questions), "with answer", answered_q)
    by = defaultdict(lambda: {"n": 0, "a": 0})
    for q in questions:
        by[q["bank"]]["n"] += 1
        if q.get("answer"):
            by[q["bank"]]["a"] += 1
    print("banks", dict(by))
    print("outlines", len(outlines), "cards", len(cards))
    print("answer keys", len(ans_index))
    # sample unanswered
    missing = [q for q in questions if not q.get("answer") and q["bank"] in {"drill", "true", "mock"}]
    print("missing answers", len(missing))
    if missing[:5]:
        for q in missing[:8]:
            print("  miss", q["bank"], q.get("chapterId"), q.get("kind"), q.get("number"), q["stem"][:40])
    return meta


if __name__ == "__main__":
    build()
