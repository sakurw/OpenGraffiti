"""Classify uncovered visible facade triangles for landmark photo acquisition planning."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("--coverage",required=True)
p.add_argument("--triangles",required=True)
p.add_argument("--output",required=True)
a=p.parse_args()
coverage=json.loads(Path(a.coverage).read_text(encoding="utf-8"))
result={"status":"uncovered-classification","uncoveredPixels":coverage.get("uncoveredVisiblePixels",0),"triangleOwnershipAvailable":"triangleAssignment" in coverage,"nextRequirement":"preserve pixel to triangle id mapping during coverage rasterization"}
Path(a.output).write_text(json.dumps(result,indent=2),encoding="utf-8")
print(json.dumps(result))
