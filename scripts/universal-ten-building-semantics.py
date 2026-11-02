"""Stream exact CityGML semantics for the fixed ten-building universal batch."""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
selection = json.loads((ROOT / "scripts/universal-ten-building-selection.json").read_text(encoding="utf-8"))
targets = {item["buildingId"] for item in selection["buildings"]}
citygml_path = ROOT / selection["cityGmlPath"]
output_dir = ROOT / "data/texture-city/universal-ten-buildings"
output_dir.mkdir(parents=True, exist_ok=True)
output_path = output_dir / "semantics.json"
GML_ID = "{http://www.opengis.net/gml}id"


def local(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def descendants(parent: ET.Element, name: str):
    return [element for element in parent.iter() if local(element) == name]


def direct_text(parent: ET.Element, name: str):
    element = next((item for item in parent if local(item) == name), None)
    if element is None or not element.text:
        return None
    value = element.text.strip()
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


records = {}
for _event, element in ET.iterparse(citygml_path, events=("end",)):
    if local(element) != "Building":
        continue
    building_id = element.get(GML_ID)
    if building_id not in targets:
        element.clear()
        continue
    polygon_semantics = {}
    surface_counts: Counter[str] = Counter()
    opening_counts: Counter[str] = Counter()
    for wrapper in [item for item in element if local(item) == "boundedBy"]:
        surface = next(iter(wrapper), None)
        if surface is None:
            continue
        semantic_class = local(surface)
        surface_counts[semantic_class] += 1
        for opening in descendants(surface, "opening"):
            opening_object = next(iter(opening), None)
            if opening_object is not None:
                opening_counts[local(opening_object)] += 1
        for polygon in descendants(surface, "Polygon"):
            polygon_id = polygon.get(GML_ID)
            if polygon_id:
                polygon_semantics[polygon_id] = {
                    "semanticClass": semantic_class,
                    "semanticSource": "PLATEAU CityGML bldg:boundedBy",
                    "surfaceId": surface.get(GML_ID),
                    "semanticConfidence": 1.0,
                }
    installations = []
    for wrapper in [item for item in element if local(item) == "outerBuildingInstallation"]:
        installation = next(iter(wrapper), None)
        if installation is None:
            continue
        polygon_ids = [polygon.get(GML_ID) for polygon in descendants(installation, "Polygon") if polygon.get(GML_ID)]
        installation_id = installation.get(GML_ID)
        installations.append({
            "installationId": installation_id,
            "polygonIds": polygon_ids,
            "polygonCount": len(polygon_ids),
            "class": direct_text(installation, "class"),
            "function": direct_text(installation, "function"),
            "usage": direct_text(installation, "usage"),
            "exactEquipmentTypeAvailable": any(direct_text(installation, key) is not None for key in ("class", "function", "usage")),
        })
        for polygon_id in polygon_ids:
            polygon_semantics[polygon_id] = {
                "semanticClass": "OuterBuildingInstallation",
                "semanticSource": "PLATEAU CityGML bldg:outerBuildingInstallation",
                "parentInstallationId": installation_id,
                "semanticConfidence": 1.0,
            }
    records[building_id] = {
        "buildingId": building_id,
        "name": direct_text(element, "name") or "",
        "classCode": direct_text(element, "class"),
        "usageCode": direct_text(element, "usage"),
        "measuredHeightMetres": direct_text(element, "measuredHeight"),
        "storeysAboveGround": direct_text(element, "storeysAboveGround"),
        "storeysBelowGround": direct_text(element, "storeysBelowGround"),
        "surfaceObjectCounts": dict(surface_counts),
        "openingCounts": dict(opening_counts),
        "installations": installations,
        "polygonSemantics": polygon_semantics,
    }
    element.clear()
    if len(records) == len(targets):
        break

missing = sorted(targets - records.keys())
if missing:
    raise RuntimeError(f"Selected buildings missing from CityGML: {missing}")

report = {
    "batchId": selection["batchId"],
    "source": selection["cityGmlPath"],
    "buildings": [records[item["buildingId"]] for item in selection["buildings"]],
}
output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "output": str(output_path.relative_to(ROOT)),
    "buildings": len(report["buildings"]),
    "polygons": sum(len(item["polygonSemantics"]) for item in report["buildings"]),
    "installations": sum(len(item["installations"]) for item in report["buildings"]),
    "named": sum(bool(item["name"]) for item in report["buildings"]),
}, ensure_ascii=False))
