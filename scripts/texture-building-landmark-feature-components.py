"""Build feature-based photo components for landmark lens grouping."""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pairs")
    p.add_argument("--min-matches", type=int, default=200)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    pairs = json.loads(Path(args.pairs).read_text(encoding="utf-8"))["pairs"]
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for pair in pairs:
        if pair["goodMatches"] >= args.min_matches:
            union(pair["sourceA"], pair["sourceB"])

    groups = {}
    for photo in list(parent):
        groups.setdefault(find(photo), []).append(photo)

    result = {
        "status": "landmark-feature-components",
        "method": "sift-match-connected-components",
        "minMatches": args.min_matches,
        "componentCount": len(groups),
        "components": list(groups.values()),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"componentCount": len(groups), "components": list(groups.values())}))


if __name__ == "__main__":
    main()
