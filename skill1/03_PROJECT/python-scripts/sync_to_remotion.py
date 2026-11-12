import json
import re

json_path = r"D:\editvideochatgpt\phuongdi1_transcript.json"
tsx_path = r"D:\editvideochatgpt\skill1\03_PROJECT\my-editor\src\Composition.tsx"

MIN_DURATION = 1.2  # Tối thiểu 1.2 giây/cảnh để tránh lỗi animation Remotion

try:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    raw_segments = data if isinstance(data, list) else data.get("segments", [])

    # 1. BỘ LỌC TỰ ĐỘNG: Gộp các câu thoại quá ngắn để loại bỏ lỗi [0,20,9][cite: 6]
    merged_segments = []
    for seg in raw_segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()

        if not text:
            continue

        if merged_segments and (end - start < MIN_DURATION or start - merged_segments[-1]["end"] < 0.2):
            # Gộp vào cảnh trước đó
            merged_segments[-1]["end"] = max(merged_segments[-1]["end"], end)
            merged_segments[-1]["text"] += " " + text
        else:
            merged_segments.append({"start": start, "end": end, "text": text})

    # 2. Sinh mã TypeScript đã chuẩn hóa mốc thời gian
    scenes_list = []
    for i, seg in enumerate(merged_segments, 1):
        start = round(seg["start"], 2)
        end = round(max(seg["end"], start + MIN_DURATION), 2)  # Đảm bảo end luôn > start + 1.2s
        text = seg["text"].strip()

        words = text.split()
        chunk_size = 4
        captions = [" ".join(words[j:j+chunk_size]) for j in range(0, len(words), chunk_size)]

        scene_item = (
            f'  {{\n'
            f'    id: "Scene_{i}",\n'
            f'    start: {start},\n'
            f'    end: {end},\n'
            f'    eyebrow: "CẢNH {i}",\n'
            f'    headline: "{text[:18].upper()}",\n'
            f'    captions: {json.dumps(captions, ensure_ascii=False)},\n'
            f'    zoom: {1.10 + (i % 3) * 0.04:.2f},\n'
            f'    effect: "{["pop", "slide", "rise"][(i-1) % 3]}",\n'
            f'  }}'
        )
        scenes_list.append(scene_item)

    scenes_code = "export const SCENES: SceneConfig[] = [\n" + ",\n".join(scenes_list) + "\n];"

    # 3. Ghi trực tiếp vào Composition.tsx
    with open(tsx_path, "r", encoding="utf-8") as f:
        content = f.read()

    updated_content = re.sub(
        r"export const SCENES: SceneConfig\[\] = \[.*?\];",
        scenes_code,
        content,
        flags=re.DOTALL
    )

    with open(tsx_path, "w", encoding="utf-8") as f:
        f.write(updated_content)

    print("\n" + "="*60)
    print("🚀 THÀNH CÔNG: Đã gộp cảnh ngắn & xử lý triệt để lỗi Remotion!")
    print("="*60 + "\n")

except Exception as e:
    print("\n❌ Lỗi:", e)