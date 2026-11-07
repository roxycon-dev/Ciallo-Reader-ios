#!/usr/bin/env python3
"""Fetch the original Android ONNX assets for the isolated simulator."""
import concurrent.futures
import hashlib
from pathlib import Path
import subprocess
import sys

MODELS = [
    ("ppocr_det.onnx", "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
     ["https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx",
      "https://hf-mirror.com/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx"]),
    ("ppocr_rec.onnx", "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
     ["https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx",
      "https://hf-mirror.com/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx"]),
    ("mt_yolo_bubble.onnx", "a01ad9477fac2b8815c2308c827c0a60a898f457a6692717201123911ba819c0",
     ["https://raw.githubusercontent.com/roxycon-dev/Ciallo-Reader/main/models/manga-bubble-seg-yolo26n.onnx",
      "https://github.com/roxycon-dev/Ciallo-Reader/releases/download/v1.0.7/manga-bubble-seg-yolo26n.onnx"]),
]

def fetch(model, root):
    name, expected, urls = model
    dest = root / name
    if dest.exists():
        with dest.open("rb") as data:
            if hashlib.file_digest(data, "sha256").hexdigest() == expected:
                return
    temp = dest.with_suffix(".part")
    try:
        for url in urls:
            result = subprocess.run(["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", "90",
                                     "--connect-timeout", "12", "--max-filesize", str(128 * 1024 * 1024), "-o", str(temp), url], check=False)
            if result.returncode:
                continue
            with temp.open("rb") as data:
                if hashlib.file_digest(data, "sha256").hexdigest() != expected:
                    continue
            temp.replace(dest)
            print(f"{name}: original SHA-256 verified", flush=True)
            return
    finally:
        temp.unlink(missing_ok=True)
    raise RuntimeError(f"No verified fixture available for {name}")

if __name__ == "__main__":
    directory = Path(sys.argv[1])
    directory.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for future in [executor.submit(fetch, model, directory) for model in MODELS]:
            future.result()
