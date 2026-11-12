import json
from pathlib import Path

base = Path(__file__).resolve().parent
whisper = json.loads((base / "whisper.json").read_text(encoding="utf-8-sig"))
scenes = [
    {"id": f"s{i+1}", "start": s["start"],
     "end": s["end"], "text": s["text"].strip()}
    for i, s in enumerate(whisper["segments"])
    if s["end"] > s["start"] and s["text"].strip()
]
output = json.dumps({"scenes": scenes}, ensure_ascii=False, indent=2)
(base / "src" / "scenes.json").write_text(output, encoding="utf-8")