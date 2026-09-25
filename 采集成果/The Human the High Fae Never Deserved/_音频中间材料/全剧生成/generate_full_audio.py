from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
import wave
import zipfile
from datetime import date
from pathlib import Path


WORK = Path(__file__).resolve().parent
PROJECT = WORK.parents[1]
SOURCE_EN = PROJECT / "_校订中间材料" / "source_en.txt"
SOURCE_ZH = PROJECT / "高阶仙族从未配得上的人类（中文剧本）.md"
CHUNKS = WORK / "chunks"
MANIFEST = WORK / "manifest.json"
OUTPUT = PROJECT / "音频" / "全剧" / "The Human the High Fae Never Deserved-单人旁白-中英对白.wav"
MODEL = "gemini-3.8-flash-tts"
VOICE = "Cleo"
MAX_CHARS = 1700
RECHUNK_MAX_CHARS = 3400
RECHUNK_MAX_BYTES = 6500
STYLE = (
    "One consistent female audiobook storyteller, warm and intimate, with natural expressive "
    "storytelling and gentle emotional nuance. Read Chinese narration in fluent Mandarin. "
    "Keep character names and every direct dialogue line in English, with clear natural "
    "Mandarin and English pronunciation. Use one narrator voice for everything; do not act "
    "separate character voices. Keep a human pace, natural pauses, and avoid robotic or "
    "formal-announcer delivery."
)

SPEAKERS = (
    "ADRIAN", "ANNA", "BRANLEY", "BRIALLEN", "EMMA", "FEMALE STUDENT",
    "GROUP OF STUDENTS", "GUARD 1", "GUARD 2", "KASTAR", "KELLAN", "MARA",
    "MESSENGER", "RAINA", "SERVANT", "STUDENT 1", "STUDENT 2", "STUDENT 3",
    "STUDENTS", "TOROS",
)
SPEAKER_RE = re.compile(
    r"^\s*(" + "|".join(re.escape(x) for x in sorted(SPEAKERS, key=len, reverse=True)) +
    r")(?:\s*:\s*(.*)|\s+(\([^\r\n]*\))\s*:?)?\s*$",
    re.IGNORECASE,
)
ACTION_VERBS = (
    "looks", "looked", "turns", "turned", "walks", "walked", "runs", "ran", "puts", "put",
    "tries", "tried", "reaches", "reached", "grabs", "grabbed", "smiles", "smiled", "laughs", "laughed",
    "shakes", "shook", "nods", "nodded", "pulls", "pulled", "pushes", "pushed", "steps", "stepped",
    "gives", "gave", "opens", "opened", "closes", "closed", "stands", "stood", "sits", "sat", "falls",
    "fell", "catches", "caught", "points", "pointed", "holds", "held", "moves", "moved", "comes", "came",
    "goes", "went", "follows", "followed", "watches", "watched", "appears", "appeared", "disappears",
    "disappeared", "flickers", "flickered", "begins", "began", "leans", "leaned", "rubs", "rubbed",
    "clenches", "clenched", "flings", "flung", "slaps", "slapped", "enters", "entered", "exits", "exited",
    "spins", "spun", "sweeps", "swept", "places", "placed", "wears", "wore", "says", "said",
    "raises", "raised", "drops", "dropped", "breaks", "broke", "hurries", "hurried", "rushes", "rushed",
    "clasps", "clasped", "continues", "continued", "stares", "stared", "brings", "brought", "climbs",
    "climbed", "snaps", "snapped", "rolls", "rolled", "ducks", "ducked", "flies", "flew", "dances",
    "danced", "leaves", "left", "keeps", "kept", "lets", "let", "becomes", "became", "appears",
)
ACTION_VERB_RE = re.compile(r"^(?:" + "|".join(ACTION_VERBS) + r")\b", re.IGNORECASE)
ACTION_PARTICIPLE_RE = re.compile(r"^(?:wearing|holding|standing|watching|looking|walking|turning|reaching|running|sitting|lying|clutching)\b", re.IGNORECASE)
ACTION_SUBJECT_RE = re.compile(
    r"^(?:(?:Emma|Mara|Toros|Kellan|Anna|Adrian|Raina|Branley|Briallen|Kastar|Headmaster Branley|Queen Anna|"
    r"He|She|They|It|His|Her|Their|Everyone|Both princes|The princes)(?:'s)?\b|The [A-Z][a-z]+)\s*,?\s+(.+)$",
    re.IGNORECASE,
)
ZH_SPEAKERS = {
    "阿德里安": "ADRIAN", "安娜": "ANNA", "布兰利": "BRANLEY", "布里艾伦": "BRIALLEN",
    "艾玛": "EMMA", "卡斯塔尔": "KASTAR", "凯兰": "KELLAN", "玛拉": "MARA",
    "雷娜": "RAINA", "托罗斯": "TOROS", "仆人": "SERVANT", "信使": "MESSENGER",
    "守卫1": "GUARD 1", "守卫2": "GUARD 2", "学生1": "STUDENT 1", "学生2": "STUDENT 2",
    "学生3": "STUDENT 3", "学生": "STUDENTS", "女学生": "FEMALE STUDENT",
}
NAME_REPLACEMENTS = {
    "布兰利校长": "Headmaster Branley", "卡斯塔尔护士": "Nurse Kastar", "阿德里安王子": "Prince Adrian",
    "托罗斯王子": "Prince Toros", "凯兰王子": "Prince Kellan", "雷娜女王": "Queen Raina",
    "安娜女王": "Queen Anna", "女王安娜": "Queen Anna", "艾玛小姐": "Miss Emma", "玛拉小姐": "Miss Mara",
    "布里艾伦": "Briallen", "阿德里安": "Adrian", "布兰利": "Branley", "卡斯塔尔": "Kastar",
    "托罗斯": "Toros", "凯兰": "Kellan", "艾玛": "Emma", "安娜": "Anna", "玛拉": "Mara", "雷娜": "Raina",
    "萨拉": "Sara", "丹尼尔": "Daniel",
    "守卫1": "Guard 1", "守卫2": "Guard 2", "学生1": "Student 1", "学生2": "Student 2", "学生3": "Student 3",
    "女学生": "female student", "学生们": "students",
}


def atomic_json(path: Path, data: object) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def episode_sections(text: str, pattern: re.Pattern[str]) -> dict[int, list[str]]:
    sections: dict[int, list[str]] = {}
    current: int | None = None
    for line in text.splitlines():
        match = pattern.match(line)
        if match:
            current = int(match.group(1))
            sections.setdefault(current, [])
        elif current is not None:
            sections[current].append(line)
    return sections


def cue(line: str) -> tuple[str, str] | None:
    match = SPEAKER_RE.match(line)
    if not match:
        return None
    name = match.group(1).upper()
    inline = match.group(2) or ""
    metadata = match.group(3) or ""
    return name, inline.strip(), metadata.strip()


def clean_dialogue(text: str) -> str:
    text = re.sub(r"\([^)]*\)|（[^）]*）", "", text)
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if not line or re.fullmatch(r"\([^)]*\)", line):
            continue
        lines.append(line)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def is_action_line(line: str) -> bool:
    stripped = line.strip()
    if re.match(r"(?i)^(?:INT\.|EXT\.|I/E\.|FADE OUT|CUT TO|DISSOLVE TO|END OF)", stripped):
        return True
    match = ACTION_SUBJECT_RE.match(stripped)
    if not match:
        return False
    tail = match.group(1).lstrip(" ,")
    return bool(ACTION_VERB_RE.match(tail) or ACTION_PARTICIPLE_RE.match(tail))


def parse_english_turns(lines: list[str]) -> tuple[list[dict[str, str]], int]:
    turns: list[dict[str, str]] = []
    nonverbal_cues = 0
    index = 0
    while index < len(lines):
        found = cue(lines[index])
        if not found:
            index += 1
            continue
        name, inline, metadata = found
        body = []
        if inline and not re.fullmatch(r"(?i)\([^)]*(?:V\.O\.|O\.S\.)[^)]*\)", inline):
            body.append(inline)
        index += 1
        while index < len(lines) and not lines[index].strip():
            index += 1
        while index < len(lines) and lines[index].strip():
            if cue(lines[index]):
                break
            if re.match(r"(?i)^\s*(?:PRESENT DAY|FLASHBACK(?:\b|\s*-)|QUICK FLASHBACK|MONTAGE\b|BACK TO SCENE|INSERT SHOT|INT\.|EXT\.|I/E\.|FADE OUT|CUT TO|DISSOLVE TO|END OF)", lines[index]):
                break
            if body and is_action_line(lines[index]):
                break
            body.append(lines[index])
            index += 1
        raw_body = "\n".join(body).strip()
        utterance = clean_dialogue(raw_body)
        if not utterance:
            nonverbal_cues += 1
        turns.append({"speaker": name, "text": utterance, "stage": raw_body, "is_speech": bool(utterance)})
    return turns, nonverbal_cues


ZH_ACTION_SUBJECT = re.compile(
    r"^(?:(?:卡斯塔尔护士|安娜女王|阿德里安王子|托罗斯王子|凯兰王子|雷娜女王|艾玛|玛拉|托罗斯|凯兰|安娜|阿德里安|雷娜|布兰利|布里艾伦|卡斯塔尔|"
    r"他们|她们|他们俩|两人|两位王子|女王|学生们|学生1|学生2|学生3|守卫1|守卫2)(?:的)?)(.*)$"
)
ZH_ACTION_VERB = re.compile(
    r"^(?:(?:突然|猛地|立刻|立即|随即|随后|接着|紧接着|开始|继续|又|便|也|正|径直|快速|快步|"
    r"试图|转|回头|走|跑|冲|扑|举|抬|伸|握|抓|把|将|拿|取|递|推|拉|放|松开|离开|站|坐|跌|摔|倒|"
    r"笑|哭|瞪|看|望|拥抱|扶|点头|摇头|低头|打开|关上|关闭|假装|装作|掏|翻|捡|移|踱步|摸|接过|"
    r"停下|飞|落|靠近|蹲|跪|迸发|闪烁|熄灭|举起|扔|甩|挥|扑向|走进|走出|站起|坐下|转身|转向|转过|"
    r"望向|看向|露出|流下|落下|滑落|坠落|倒下|伸出|抓住|抱起|抬头|后退|前进|躲|注视|凝视|凝望|皱眉))"
)


def extract_chinese_action(lines: list[str]) -> list[str]:
    actions: list[str] = []
    seen_dialogue = False
    action_started = False
    for line in lines:
        # Chinese manuscript paragraphs are hard-wrapped; split at sentence punctuation
        # so a narration sentence following translated dialogue can be retained.
        parts = re.split(r"(?<=[。！？])", line.strip())
        for part in parts:
            part = part.strip()
            if not part:
                continue
            part = re.sub(r"^[（(][^）)]*[）)]\s*", "", part).strip()
            if not part:
                continue
            if action_started:
                actions.append(part)
                continue
            candidate = re.sub(r"^(?:这时|随后|接着|紧接着|此时|与此同时|而后|随即)[，、]?", "", part)
            match = ZH_ACTION_SUBJECT.match(candidate)
            if seen_dialogue and match and ZH_ACTION_VERB.match(match.group(1)):
                actions.append(part)
                action_started = True
            else:
                seen_dialogue = True
    return ["".join(actions)] if actions else []


def parse_chinese_items(lines: list[str]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    items: list[dict[str, str]] = []
    turns: list[dict[str, str]] = []
    pending: list[str] = []

    def flush() -> None:
        nonlocal pending
        if pending:
            text = " ".join(x.strip() for x in pending if x.strip())
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                items.append({"type": "narration", "text": text})
            pending = []

    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            flush()
            index += 1
            continue
        if line.startswith("#"):
            flush()
            heading = re.sub(r"^#{1,6}\s*", "", line).strip()
            if heading:
                items.append({"type": "narration", "text": heading})
            index += 1
            continue
        label = re.fullmatch(r"\*\*([^*]+)：\*\*\s*(.*)", line)
        if label:
            flush()
            zh_name = label.group(1).strip()
            if zh_name not in ZH_SPEAKERS:
                raise ValueError(f"Unmapped Chinese speaker label: {zh_name}")
            body = [label.group(2)] if label.group(2) else []
            index += 1
            while index < len(lines) and not lines[index].strip():
                index += 1
            while index < len(lines) and lines[index].strip() and not lines[index].strip().startswith("#"):
                if re.fullmatch(r"\*\*[^*]+：\*\*\s*.*", lines[index].strip()):
                    break
                body.append(lines[index].strip())
                index += 1
            zh_text = re.sub(r"\s+", " ", " ".join(body)).strip()
            if not zh_text:
                raise ValueError(f"Empty Chinese dialogue after {zh_name}")
            extra_narration = extract_chinese_action(body)
            turns.append({"speaker": ZH_SPEAKERS[zh_name], "text": zh_text})
            items.append({"type": "dialogue", "zh_speaker": ZH_SPEAKERS[zh_name], "zh_text": zh_text, "extra_narration": extra_narration})
            continue
        pending.append(re.sub(r"\*\*(.*?)\*\*", r"\1", line))
        index += 1
    flush()
    return items, turns


def compatible(a: str, b: str) -> bool:
    if a == b:
        return True
    if a == "STUDENTS":
        return b in {"STUDENTS", "GROUP OF STUDENTS", "FEMALE STUDENT", "STUDENT 1", "STUDENT 2", "STUDENT 3"}
    return False


def align_turns(source: list[dict[str, str]], translated: list[dict[str, str]]) -> dict[int, int]:
    n, m = len(source), len(translated)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            match = 1 + dp[i + 1][j + 1] if compatible(source[i]["speaker"], translated[j]["speaker"]) else -1
            dp[i][j] = max(match, dp[i + 1][j], dp[i][j + 1])
    mapping: dict[int, int] = {}
    i = j = 0
    while i < n and j < m:
        if compatible(source[i]["speaker"], translated[j]["speaker"]) and dp[i][j] == 1 + dp[i + 1][j + 1]:
            mapping[j] = i
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    if len(mapping) != m:
        missing = [translated[k]["speaker"] for k in range(m) if k not in mapping]
        raise ValueError(f"Could not align every translated speaker tag: {missing}")
    return mapping


def english_label(name: str) -> str:
    fixed = {"GROUP OF STUDENTS": "Students", "STUDENTS": "Students"}
    return fixed.get(name, " ".join(word.capitalize() for word in name.split()))


def replace_names(text: str) -> str:
    for old, new in sorted(NAME_REPLACEMENTS.items(), key=lambda pair: len(pair[0]), reverse=True):
        text = text.replace(old, new)
    return text


def nonverbal_narration(speaker: str, text: str) -> str:
    subject = {
        "STUDENTS": "学生们", "GROUP OF STUDENTS": "学生们", "FEMALE STUDENT": "那名女学生",
        "STUDENT 1": "学生一", "STUDENT 2": "学生二", "STUDENT 3": "学生三",
    }.get(speaker, english_label(speaker))
    cue_text = text.strip(" ()（）")
    if "尖叫" in cue_text or "尖声" in cue_text:
        return f"{subject}尖叫起来。"
    if "低语" in cue_text or "窃窃私语" in cue_text:
        return f"{subject}低声议论起来。"
    if "喘息" in cue_text or "抽气" in cue_text or "惊呼" in cue_text:
        if "低语" in cue_text or "窃窃私语" in cue_text:
            return f"{subject}发出惊呼，随后低声议论。"
        return f"{subject}发出一声惊呼。"
    if "哭" in cue_text:
        return f"{subject}哭了起来。"
    return f"{subject}发出声响。" if not cue_text else ""


def prepare() -> dict[str, object]:
    if not SOURCE_EN.is_file() or not SOURCE_ZH.is_file():
        raise FileNotFoundError("English source or final Chinese script is missing")
    en = episode_sections(SOURCE_EN.read_text(encoding="utf-8-sig"), re.compile(r"^Episode\s+(\d+)\s*$"))
    zh = episode_sections(SOURCE_ZH.read_text(encoding="utf-8-sig"), re.compile(r"^## 第(\d+)集\s*$"))
    if set(en) != set(zh) or len(en) != 67:
        raise ValueError(f"Episode mismatch: English={len(en)}, Chinese={len(zh)}")

    spoken: list[str] = []
    all_turns = translated_turns = nonverbal_cues = dialogue_added = 0
    per_episode = []
    for episode in range(1, 68):
        source_turns, skipped = parse_english_turns(en[episode])
        nonverbal_cues += skipped
        items, zh_turns = parse_chinese_items(zh[episode])
        mapping = align_turns(source_turns, zh_turns)
        mapped_source_indices = set(mapping.values())
        added_here = sum(1 for i, turn in enumerate(source_turns) if turn["is_speech"] and i not in mapped_source_indices)
        dialogue_added += added_here
        source_index = 0
        zh_index = 0
        episode_text: list[str] = []
        for item in items:
            if item["type"] == "narration":
                episode_text.append(replace_names(item["text"]))
                continue
            matched_source = mapping[zh_index]
            zh_index += 1
            while source_index < matched_source:
                turn = source_turns[source_index]
                if turn["is_speech"]:
                    episode_text.append(f"{english_label(turn['speaker'])}: {turn['text']}")
                source_index += 1
            turn = source_turns[matched_source]
            if turn["is_speech"]:
                episode_text.append(f"{english_label(turn['speaker'])}: {turn['text']}")
            else:
                spoken_action = nonverbal_narration(turn["speaker"], item["zh_text"])
                if spoken_action:
                    episode_text.append(spoken_action)
            episode_text.extend(replace_names(text) for text in item.get("extra_narration", []))
            source_index = matched_source + 1
        while source_index < len(source_turns):
            turn = source_turns[source_index]
            if turn["is_speech"]:
                episode_text.append(f"{english_label(turn['speaker'])}: {turn['text']}")
            source_index += 1
        translated_turns += len(zh_turns)
        speech_turns = sum(bool(turn["is_speech"]) for turn in source_turns)
        all_turns += speech_turns
        per_episode.append({"episode": episode, "english_dialogue_turns": speech_turns, "english_dialogue_turns_added": added_here, "english_nonverbal_cues": skipped, "chinese_speaker_tags": len(zh_turns)})
        spoken.append("\n\n".join(episode_text))

    transcript = "\n\n".join(spoken).strip() + "\n"
    WORK.mkdir(parents=True, exist_ok=True)
    CHUNKS.mkdir(parents=True, exist_ok=True)
    input_hash = hashlib.sha256(SOURCE_EN.read_bytes() + SOURCE_ZH.read_bytes()).hexdigest()
    transcript_hash = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    previous = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.is_file() else None
    if previous and previous.get("chunks_complete"):
        if any(previous.get(key) != value for key, value in (
            ("model", MODEL), ("voice", VOICE), ("style", STYLE),
            ("input_sha256", input_hash), ("transcript_sha256", transcript_hash),
        )):
            raise ValueError("Sources or generation settings changed after audio was generated.")
        text_chunks = [(CHUNKS / f"{index:03}.txt").read_text(encoding="utf-8")
                       for index in range(1, int(previous["chunk_count"]) + 1)]
    else:
        text_chunks = split_transcript(transcript)
    chunk_hashes = [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in text_chunks]
    if previous and previous.get("chunks_complete") and chunk_hashes != previous.get("chunk_text_sha256"):
        raise ValueError("Saved chunk text differs from the audio checkpoint.")
    same_run = bool(previous and previous.get("model") == MODEL and previous.get("voice") == VOICE and previous.get("style") == STYLE and previous.get("input_sha256") == input_hash and previous.get("transcript_sha256") == transcript_hash and previous.get("chunk_text_sha256") == chunk_hashes)
    if previous and not same_run and previous.get("chunks_complete"):
        raise ValueError("Sources or transcript changed after audio was generated; refusing to overwrite the existing checkpoint.")
    (WORK / "spoken_script.md").write_text(transcript, encoding="utf-8")
    if not same_run:
        for path in CHUNKS.glob("*.txt"):
            path.unlink()
    for index, text in enumerate(text_chunks, 1):
        target = CHUNKS / f"{index:03}.txt"
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            target.write_text(text, encoding="utf-8")
    manifest = {
        "model": MODEL,
        "voice": VOICE,
        "style": STYLE,
        "input_sha256": input_hash,
        "transcript_sha256": transcript_hash,
        "chunk_text_sha256": chunk_hashes,
        "episode_count": 67,
        "english_dialogue_turns": all_turns,
        "english_dialogue_turns_added_from_source": dialogue_added,
        "english_nonverbal_cues": nonverbal_cues,
        "chinese_speaker_tags": translated_turns,
        "transcript_characters": len(transcript),
        "chunk_count": len(text_chunks),
        "max_chunk_characters": max(map(len, text_chunks), default=0),
        "chunks_complete": previous.get("chunks_complete", []) if same_run else [],
        "per_episode": per_episode,
        "status": previous.get("status", "prepared") if same_run else "prepared",
    }
    if same_run:
        for key in ("chunk_audio_sha256", "last_error", "merged_output", "merged_bytes", "duration_seconds"):
            if key in previous:
                manifest[key] = previous[key]
    atomic_json(MANIFEST, manifest)
    return manifest


def split_transcript(text: str) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for paragraph in (part.strip() for part in text.split("\n\n") if part.strip()):
        pending = [paragraph]
        pieces: list[str] = []
        while pending:
            piece = pending.pop(0)
            if len(piece) <= MAX_CHARS:
                pieces.append(piece)
                continue
            cut = piece.rfind("。", 0, MAX_CHARS)
            if cut < MAX_CHARS // 2:
                cut = piece.rfind(" ", 0, MAX_CHARS)
            if cut < MAX_CHARS // 2:
                cut = MAX_CHARS
            else:
                cut += 1
            pending.insert(0, piece[cut:].strip())
            pending.insert(0, piece[:cut].strip())
        for piece in pieces:
            if current and size + len(piece) + 2 > MAX_CHARS:
                chunks.append("\n\n".join(current))
                current, size = [], 0
            current.append(piece)
            size += len(piece) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def rechunk_pending() -> None:
    manifest = prepare()
    total = int(manifest["chunk_count"])
    complete = sorted(set(int(index) for index in manifest["chunks_complete"]))
    if complete != list(range(1, len(complete) + 1)):
        raise ValueError("Completed chunks must be a contiguous prefix before rechunking.")
    kept = len(complete)
    old = [(CHUNKS / f"{index:03}.txt").read_text(encoding="utf-8")
           for index in range(1, total + 1)]
    for index in complete:
        path = CHUNKS / f"{index:03}.wav"
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != manifest.get("chunk_audio_sha256", {}).get(str(index)):
            raise ValueError(f"Completed audio {index} is missing or differs from its checkpoint.")
    if any((CHUNKS / f"{index:03}.wav").exists() for index in range(kept + 1, total + 1)):
        raise ValueError("An uncheckpointed WAV exists among pending chunks; inspect it before rechunking.")

    pending: list[str] = []
    for part in old[kept:]:
        if len(part) > RECHUNK_MAX_CHARS or len(part.encode("utf-8")) > RECHUNK_MAX_BYTES:
            raise ValueError("An existing pending chunk exceeds the safe rechunk limit.")
        joined = pending[-1] + "\n\n" + part if pending else part
        if pending and len(joined) <= RECHUNK_MAX_CHARS and len(joined.encode("utf-8")) <= RECHUNK_MAX_BYTES:
            pending[-1] = joined
        else:
            pending.append(part)
    if pending == old[kept:]:
        print(f"Pending chunks already fit the safe grouping: {total - kept} requests remaining")
        return
    if "\n\n".join(pending) != "\n\n".join(old[kept:]):
        raise ValueError("Rechunking changed the pending text.")

    backup = WORK / f"chunks_before_rechunk_{total}_{date.today():%Y%m%d}.zip"
    if not backup.exists():
        with zipfile.ZipFile(backup, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(MANIFEST, "manifest.json")
            for index in range(1, total + 1):
                archive.write(CHUNKS / f"{index:03}.txt", f"chunks/{index:03}.txt")
    with zipfile.ZipFile(backup) as archive:
        if (archive.testzip() or archive.read("manifest.json") != MANIFEST.read_bytes() or
            any(archive.read(f"chunks/{index:03}.txt") != (CHUNKS / f"{index:03}.txt").read_bytes()
                for index in range(1, total + 1))):
            raise ValueError(f"Rechunk backup differs from the current checkpoint: {backup}")

    new_chunks = old[:kept] + pending
    for index in range(kept + 1, len(new_chunks) + 1):
        target = CHUNKS / f"{index:03}.txt"
        temp = target.with_suffix(".txt.tmp")
        temp.write_text(new_chunks[index - 1], encoding="utf-8")
        temp.replace(target)
    if [hashlib.sha256((CHUNKS / f"{index:03}.txt").read_text(encoding="utf-8").encode("utf-8")).hexdigest()
        for index in range(1, len(new_chunks) + 1)] != [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in new_chunks]:
        raise ValueError(f"Rechunked files failed validation; restore from {backup}")
    manifest["chunk_text_sha256"] = [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in new_chunks]
    manifest["chunk_count"] = len(new_chunks)
    manifest["max_chunk_characters"] = max(map(len, new_chunks))
    manifest["status"] = "prepared"
    manifest.pop("last_error", None)
    atomic_json(MANIFEST, manifest)
    for index in range(len(new_chunks) + 1, total + 1):
        (CHUNKS / f"{index:03}.txt").unlink()
    print(f"Rechunked {total - kept} pending chunks into {len(pending)}; total {len(new_chunks)}, kept {kept} WAVs; backup: {backup}")


def find_audio(node: object, under_audio: bool = False) -> str | None:
    if isinstance(node, dict):
        kind = str(node.get("type", "")).lower()
        mime = str(node.get("mime_type", node.get("mimeType", ""))).lower()
        for key in ("output_audio", "outputAudio"):
            if key in node:
                found = find_audio(node[key], True)
                if found:
                    return found
        data = node.get("data")
        if isinstance(data, str) and (under_audio or kind == "audio" or mime.startswith("audio/")):
            return data
        for value in node.values():
            found = find_audio(value, under_audio or kind == "audio" or mime.startswith("audio/"))
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find_audio(value, under_audio)
            if found:
                return found
    return None


def load_manifest() -> dict[str, object]:
    if not MANIFEST.is_file():
        raise FileNotFoundError("Run prepare first")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def status() -> None:
    manifest = load_manifest()
    done = len(manifest.get("chunks_complete", []))
    total = int(manifest["chunk_count"])
    print(f"Status: {manifest['status']} | chunks {done}/{total} | dialogue turns {manifest['english_dialogue_turns']} | transcript chars {manifest['transcript_characters']}")
    if manifest.get("last_error"):
        print("Last error:", manifest["last_error"])


def run(limit: int = 0) -> None:
    if limit < 0:
        raise ValueError("--limit must be nonnegative")
    manifest = load_manifest()
    key = getpass.getpass("Gemini API key (hidden input): ").strip()
    if not key:
        raise ValueError("No API key supplied")
    completed = set(int(x) for x in manifest.get("chunks_complete", []))
    total = int(manifest["chunk_count"])
    manifest["status"] = "running"
    manifest.pop("last_error", None)
    atomic_json(MANIFEST, manifest)
    saved = 0
    for index in range(1, total + 1):
        if index in completed:
            continue
        text = (CHUNKS / f"{index:03}.txt").read_text(encoding="utf-8")
        payload = {
            "model": MODEL,
            "input": [{
                "type": "user_input",
                "content": [{
                    "type": "text",
                    "text": text,
                    "annotations": [{"type": "speech_metadata", "style": STYLE}],
                }],
            }],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": VOICE}]},
        }
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            method="POST",
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                result = json.loads(response.read().decode("utf-8"))
            encoded = find_audio(result)
            if not encoded:
                raise ValueError("API returned no audio payload")
            audio = base64.b64decode(encoded, validate=True)
            if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
                raise ValueError("API audio payload is not a WAV file")
            target = CHUNKS / f"{index:03}.wav"
            temp = target.with_suffix(".wav.tmp")
            temp.write_bytes(audio)
            temp.replace(target)
            completed.add(index)
            manifest["chunks_complete"] = sorted(completed)
            manifest["last_error"] = None
            manifest["status"] = "running"
            manifest.setdefault("chunk_audio_sha256", {})[str(index)] = hashlib.sha256(audio).hexdigest()
            atomic_json(MANIFEST, manifest)
            print(f"Saved {index}/{total} ({time.monotonic() - started:.1f}s, {len(audio):,} bytes)", flush=True)
            saved += 1
            if limit and saved >= limit:
                manifest["status"] = "paused"
                atomic_json(MANIFEST, manifest)
                print(f"Paused after {saved} new chunk(s); saved {len(completed)}/{total}", flush=True)
                return
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")[:1200].replace(key, "[redacted]")
            manifest["status"] = "stopped_on_api_error"
            manifest["last_error"] = f"HTTP {error.code}: {body}"
            atomic_json(MANIFEST, manifest)
            print(f"Stopped at chunk {index}/{total}: HTTP {error.code}. Saved {len(completed)}/{total}; no retry or billing change.", flush=True)
            print(body, flush=True)
            return
        except Exception as error:
            message = str(error).replace(key, "[redacted]")[:1200]
            manifest["status"] = "stopped_on_error"
            manifest["last_error"] = message
            atomic_json(MANIFEST, manifest)
            print(f"Stopped at chunk {index}/{total}: {message}. Saved {len(completed)}/{total}; resume skips completed chunks.", flush=True)
            return
    manifest["status"] = "all_chunks_generated"
    manifest["last_error"] = None
    atomic_json(MANIFEST, manifest)
    print(f"All chunks generated: {total}/{total}", flush=True)


def merge() -> None:
    manifest = load_manifest()
    total = int(manifest["chunk_count"])
    missing = [i for i in range(1, total + 1) if i not in set(int(x) for x in manifest.get("chunks_complete", [])) or not (CHUNKS / f"{i:03}.wav").is_file()]
    if missing:
        raise ValueError(f"Cannot merge: incomplete chunks {missing[:20]}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".wav.tmp")
    with wave.open(str(CHUNKS / "001.wav"), "rb") as first:
        params = first.getparams()
        with wave.open(str(temp), "wb") as merged:
            merged.setparams(params)
            for index in range(1, total + 1):
                with wave.open(str(CHUNKS / f"{index:03}.wav"), "rb") as chunk:
                    if (chunk.getnchannels(), chunk.getsampwidth(), chunk.getframerate(), chunk.getcomptype()) != (params.nchannels, params.sampwidth, params.framerate, params.comptype):
                        raise ValueError(f"Incompatible WAV format in chunk {index}")
                    while True:
                        frames = chunk.readframes(48000)
                        if not frames:
                            break
                        merged.writeframesraw(frames)
    temp.replace(OUTPUT)
    with wave.open(str(OUTPUT), "rb") as merged:
        duration = merged.getnframes() / merged.getframerate()
        manifest["merged_output"] = str(OUTPUT)
        manifest["merged_bytes"] = OUTPUT.stat().st_size
        manifest["duration_seconds"] = round(duration, 2)
        manifest["status"] = "merged"
    atomic_json(MANIFEST, manifest)
    print(f"Merged {total} chunks: {OUTPUT} | {duration / 3600:.2f} hours | {OUTPUT.stat().st_size:,} bytes")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("prepare", "rechunk", "status", "run", "merge"))
    parser.add_argument("--limit", type=int, default=0, help="Maximum new chunks to generate in this run (0 means all)")
    args = parser.parse_args()
    command = args.command
    try:
        if command == "prepare":
            result = prepare()
            print(json.dumps({k: result[k] for k in ("episode_count", "english_dialogue_turns", "english_dialogue_turns_added_from_source", "english_nonverbal_cues", "chinese_speaker_tags", "transcript_characters", "chunk_count", "max_chunk_characters")}, ensure_ascii=False, indent=2))
        elif command == "rechunk":
            rechunk_pending()
        elif command == "status":
            status()
        elif command == "run":
            run(args.limit)
        else:
            merge()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
