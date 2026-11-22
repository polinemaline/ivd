#!/usr/bin/env python3
"""Fetch the real UCI student-mat.csv for the GitHub Pages deployment.

No third-party Python libraries are required. The complete CSV is verified
before it is written into the published static site.
"""
from __future__ import annotations

import csv
import hashlib
import io
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "student-mat.csv"
UCI_ZIP = "https://archive.ics.uci.edu/static/public/320/student+performance.zip"
GITHUB_MIRROR = "https://raw.githubusercontent.com/MakroMB/student-performance-analysis/main/data/student-mat.csv"


def extract_mat_csv(payload: bytes, depth: int = 0) -> bytes:
    """UCI distributes a ZIP that can contain another ZIP."""
    if depth > 3:
        raise ValueError("Unexpectedly deep ZIP nesting")
    if not payload.startswith(b"PK"):
        return payload
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        for name in names:
            if name.lower().endswith("student-mat.csv"):
                return archive.read(name)
        for name in names:
            if name.lower().endswith(".zip") and not name.startswith("__MACOSX"):
                try:
                    return extract_mat_csv(archive.read(name), depth + 1)
                except (ValueError, zipfile.BadZipFile):
                    continue
    raise ValueError("student-mat.csv is missing from downloaded archive")


def validate(payload: bytes) -> tuple[bytes, list[dict[str, str]]]:
    text = payload.decode("utf-8-sig")
    table = csv.DictReader(io.StringIO(text), delimiter=";")
    if not table.fieldnames or len(table.fieldnames) != 33:
        raise ValueError("Expected 33 original columns")
    required = {"school", "sex", "studytime", "absences", "G1", "G2", "G3"}
    if not required.issubset(table.fieldnames):
        raise ValueError("Missing required fields")
    rows = list(table)
    if len(rows) != 395:
        raise ValueError(f"Expected 395 observations, received {len(rows)}")
    for index, row in enumerate(rows, start=1):
        if row["school"] not in {"GP", "MS"} or row["sex"] not in {"M", "F"}:
            raise ValueError(f"Invalid school/sex in record {index}")
        if int(row["studytime"]) not in {1,2,3,4} or int(row["absences"]) < 0:
            raise ValueError(f"Invalid study/absences in record {index}")
        if any(int(row[key]) not in range(21) for key in ("G1", "G2", "G3")):
            raise ValueError(f"Invalid grade in record {index}")
    return text.encode("utf-8"), rows


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "DataLab03-GitHubPages/1.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()


def main() -> None:
    last_error = None
    for source in (UCI_ZIP, GITHUB_MIRROR):
        try:
            data, rows = validate(extract_mat_csv(fetch(source)))
            OUTPUT.write_bytes(data)
            print("Saved:", OUTPUT)
            print("Source:", source)
            print("Records:", len(rows))
            print("School breakdown:", {s: sum(r["school"] == s for r in rows) for s in ("GP", "MS")})
            print("SHA256:", hashlib.sha256(data).hexdigest())
            return
        except Exception as exc:  # Try the verified public mirror as backup.
            print("Failed source:", source, "—", str(exc))
            last_error = exc
    raise SystemExit(f"No complete, valid UCI dataset could be retrieved: {last_error}")


if __name__ == "__main__":
    main()
