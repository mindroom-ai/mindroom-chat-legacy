#!/usr/bin/env python3
"""Generate complete SVG image layers without putting artwork in the page DOM."""

import argparse
import copy
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
DIRECTORY = Path(__file__).resolve().parents[1] / "src/app/mindroom/messages"
LAYERS = {
    "base": {"outer-frame", "left-rooms", "right-rooms"},
    "core": {"central-cube"},
}


def references(element):
    for node in element.iter():
        for attribute, value in node.attrib.items():
            yield from re.findall(r"url\(#([^)]*)\)", value)
            if attribute.endswith("href") and value.startswith("#"):
                yield value[1:]


def image_layer(source, groups):
    ids = {node.get("id"): node for node in source.iter() if node.get("id")}
    required = set(groups)
    pending = list(groups)
    while pending:
        identifier = pending.pop()
        if identifier not in ids:
            raise ValueError(f"Missing artwork reference: {identifier}")
        for reference in references(ids[identifier]):
            if reference not in required:
                required.add(reference)
                pending.append(reference)

    image = copy.deepcopy(source)
    logo = image.find(f"{{{SVG}}}g[@id='logo']")
    if logo is None:
        raise ValueError("Missing logo group")
    for child in list(logo):
        if child.get("id") not in groups:
            logo.remove(child)
    for definitions in image.findall(f"{{{SVG}}}defs"):
        for definition in list(definitions):
            if not any(node.get("id") in required for node in definition.iter()):
                definitions.remove(definition)
    # Keep the original square viewBox, including the core's animation origin.
    return ET.tostring(image, encoding="utf-8", xml_declaration=True) + b"\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated layers are stale")
    arguments = parser.parse_args()
    source = ET.parse(DIRECTORY / "thinking-mark.svg").getroot()
    stale = []
    for name, groups in LAYERS.items():
        path = DIRECTORY / f"thinking-mark-{name}.svg"
        content = image_layer(source, groups)
        if arguments.check:
            if not path.exists() or path.read_bytes() != content:
                stale.append(path.name)
        else:
            path.write_bytes(content)
    if stale:
        raise SystemExit("Regenerate thinking artwork: " + ", ".join(stale))


if __name__ == "__main__":
    main()
