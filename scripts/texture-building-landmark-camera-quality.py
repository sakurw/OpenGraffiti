"""Rank calibrated landmark cameras before multi-view coverage evaluation."""
import argparse
import json
from pathlib import Path


def score_camera(data):
    score = 100.0
    held_out = data.get("heldOutMedianPixels")
    if held_out is None:
        score -= 25.0
    else:
        score -= min(float(held_out) * 3.0, 45.0)

    focal = float(data["cameraMatrix"][0][0])
    if focal < 700 or focal > 8000:
        score -= 35.0

    score -= 10.0 if data.get("heldOutControlCount", 0) == 0 else 0.0
    return max(score, 0.0)


def tier(score):
    if score >= 75:
        return "A"
    if score >= 50:
        return "B"
    return "C"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--output", default="data/texture-city/landmark-camera-quality.json")
    args = parser.parse_args()

    cameras = []
    for path in args.inputs:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        cameras.append({
            "source": path,
            "sourceId": data.get("sourceId"),
            "qualityScore": score_camera(data),
            "qualityTier": tier(score_camera(data)),
            "heldOutMedianPixels": data.get("heldOutMedianPixels"),
            "focalPixels": data["cameraMatrix"][0][0],
            "usableForMultiView": score_camera(data) >= 50,
        })

    cameras.sort(key=lambda x: x["qualityScore"], reverse=True)
    result = {"status": "landmark-camera-quality", "cameras": cameras}
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
