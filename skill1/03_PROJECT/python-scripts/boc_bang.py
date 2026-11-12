# -*- coding: utf-8 -*-
r"""Chay local: py D:\boc_bang.py

Khong goi API, khong tai video len mang, khong render video.
Whisper co the tai model small lan dau neu may chua co model.
Moc segment cua Whisper la doan loi noi, khong luon trung tron mot cau.
"""

import json
from pathlib import Path
import shutil
import sys

VIDEO_PATH = Path(r"D:\editvideochatgpt\source\phuongdi1.mp4")


def timestamp(seconds):
    milliseconds = round(float(seconds) * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if not VIDEO_PATH.is_file():
        raise FileNotFoundError(f"Không tìm thấy video: {VIDEO_PATH}")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "Không tìm thấy FFmpeg trong PATH. Hãy thêm thư mục chứa "
            "ffmpeg.exe vào PATH, mở lại CMD rồi chạy lại."
        )

    import torch
    import whisper

    # CPU để chạy được cả khi PyTorch không hỗ trợ CUDA trên máy.
    torch.set_num_threads(4)
    print("Đang nạp Whisper small trên CPU của máy bạn...", flush=True)
    model = whisper.load_model("small", device="cpu")
    print("Đang bóc băng tiếng Việt; không gửi video lên đám mây...", flush=True)
    result = model.transcribe(
        str(VIDEO_PATH),
        language="vi",
        task="transcribe",
        word_timestamps=True,
        fp16=False,
        temperature=0,
        verbose=False,
    )

    print("\nTRANSCRIPT THEO ĐOẠN/CÂU WHISPER\n")
    lines = []
    for number, segment in enumerate(result["segments"], start=1):
        start = float(segment["start"])
        end = float(segment["end"])
        text = segment["text"].strip()
        if not text:
            continue
        line = (
            f"{number:03d}. [{timestamp(start)} - {timestamp(end)}] "
            f"({start:.3f}s - {end:.3f}s) {text}"
        )
        print(line, flush=True)
        lines.append(line)

    # Luu canh file .py; JSON giu ca timestamp tung tu de sua phu de.
    output_dir = Path(__file__).resolve().parent
    txt_path = output_dir / "phuongdi1_transcript.txt"
    json_path = output_dir / "phuongdi1_transcript.json"
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nĐã lưu: {txt_path}\nĐã lưu: {json_path}")
    print("Hãy nghe đối chiếu các từ và số liệu chưa rõ trước khi chốt phụ đề.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nĐã dừng theo yêu cầu.", file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print(f"\nLỗi: {error}", file=sys.stderr)
        sys.exit(1)
