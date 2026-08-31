#!/usr/bin/env python3
"""Create one review JSON per property ZIP without uploading or changing data."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath


def normalized_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def safe_output_name(index: int, project_name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", project_name).strip(" .") or "property"
    return f"{index:03d} - {name}.review.json"


def read_json(archive: zipfile.ZipFile, path: str) -> object:
    return json.loads(archive.read(path).decode("utf-8-sig"))


def basename(path: str) -> str:
    return PurePosixPath(path.replace("\\", "/")).name.lower()


def unsafe_archive_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    return normalized.startswith("/") or bool(re.match(r"^[A-Za-z]:/", normalized)) or ".." in parts


def manifest_rows(value: object, key: str | None = None) -> list[dict]:
    if key and isinstance(value, dict):
        value = value.get(key, [])
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def package_number(path: Path) -> int:
    match = re.match(r"\s*(\d+)\s*-", path.stem)
    return int(match.group(1)) if match else 999999


def stage_package(path: Path, output_dir: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        bad_crc = archive.testzip()
        if bad_crc:
            raise ValueError(f"CRC validation failed at {bad_crc}")

        entries = [info for info in archive.infolist() if not info.is_dir()]
        names = [info.filename.replace("\\", "/") for info in entries]
        names_set = set(names)
        unsafe = [name for name in names if unsafe_archive_path(name)]
        if unsafe:
            raise ValueError(f"Unsafe archive paths: {unsafe[:3]}")

        property_files = [name for name in names if basename(name) == "property_upload.txt"]
        project_files = [name for name in names if basename(name) == "project_data.json"]
        if len(property_files) != 1 or len(project_files) != 1:
            raise ValueError(
                f"Expected one property_upload.txt and project_data.json; found {len(property_files)} and {len(project_files)}"
            )

        property_text = archive.read(property_files[0]).decode("utf-8-sig", "replace")
        project_data = read_json(archive, project_files[0])
        if not isinstance(project_data, dict):
            raise ValueError("project_data.json must contain an object")

        text_match = re.search(r"^Project / Property Name:\s*(.*?)\s*$", property_text, re.I | re.M)
        text_project_name = text_match.group(1).strip() if text_match else ""
        project_name = str(project_data.get("project_name") or "").strip()
        filename_project_name = re.sub(r"^\s*\d+\s*-\s*", "", path.stem).strip()
        if not project_name or normalized_name(project_name) != normalized_name(text_project_name):
            raise ValueError("Project name does not match between property_upload.txt and project_data.json")
        if normalized_name(filename_project_name) != normalized_name(project_name):
            raise ValueError("ZIP filename does not match project_data.json project name")

        asset_manifest_path = next((name for name in names if basename(name) == "asset_manifest.json"), "")
        asset_manifest = read_json(archive, asset_manifest_path) if asset_manifest_path else []
        asset_rows = manifest_rows(asset_manifest)

        phase_records = []
        manifest_targets = []
        rera_detail_paths = sorted(
            name for name in names if re.search(r"(?:^|/)rera_documents/.+/project_details\.json$", name, re.I)
        )
        for detail_path in rera_detail_paths:
            phase_dir = detail_path.rsplit("/", 1)[0]
            details = read_json(archive, detail_path)
            manifest_path = f"{phase_dir}/manifest.json"
            manifest = read_json(archive, manifest_path) if manifest_path in names_set else {"documents": []}
            documents = manifest_rows(manifest, "documents")
            phase_records.append(
                {
                    "directory": phase_dir,
                    "projectDetailsPath": detail_path,
                    "projectDetails": details,
                    "manifestPath": manifest_path if manifest_path in names_set else "",
                    "documents": documents,
                }
            )
            for row in documents:
                saved_as = str(row.get("saved_as") or "").replace("\\", "/").lstrip("/")
                if saved_as:
                    manifest_targets.append((manifest_path, saved_as, f"{phase_dir}/{saved_as}"))

        for row in asset_rows:
            saved_as = str(row.get("saved_as") or "").replace("\\", "/").lstrip("/")
            if saved_as:
                manifest_targets.append((asset_manifest_path, saved_as, saved_as))

        missing_targets = []
        ambiguous_targets = []
        resolved_targets = []
        for manifest_path, saved_as, scoped_path in manifest_targets:
            candidates = list(dict.fromkeys(candidate for candidate in (saved_as, scoped_path) if candidate in names_set))
            if not candidates:
                missing_targets.append({"manifest": manifest_path, "savedAs": saved_as})
            elif len(candidates) > 1:
                ambiguous_targets.append({"manifest": manifest_path, "savedAs": saved_as, "matches": candidates})
            else:
                resolved_targets.append({"manifest": manifest_path, "savedAs": saved_as, "archivePath": candidates[0]})

        if missing_targets or ambiguous_targets:
            raise ValueError(
                f"Manifest validation failed: {len(missing_targets)} missing, {len(ambiguous_targets)} ambiguous"
            )

        source_audit_path = next((name for name in names if basename(name) == "source_audit.json"), "")
        source_audit = read_json(archive, source_audit_path) if source_audit_path else {}
        rera_numbers = sorted(
            {
                str(number).strip().upper()
                for number in project_data.get("rera_numbers", [])
                if str(number).strip()
            }
        )
        warnings = []
        if not phase_records and rera_numbers:
            warnings.append("RERA number is present but no official RERA project-details folder is packaged.")
        if not rera_numbers:
            warnings.append("No RERA number is supplied; leave RERA fields blank unless verified manually.")

        staged = {
            "schemaVersion": 1,
            "importState": "awaiting_review",
            "package": {
                "packageName": path.name,
                "packageSize": path.stat().st_size,
                "packageKey": f"{path.name.lower()}::{path.stat().st_size}",
                "projectName": project_name,
                "propertyType": str(project_data.get("property_type") or "Apartment"),
                "entryCount": len(entries),
            },
            "propertyUploadText": property_text,
            "projectData": project_data,
            "reraPhases": phase_records,
            "assetManifestPath": asset_manifest_path,
            "assetManifest": asset_rows,
            "sourceAudit": source_audit,
            "resolvedManifestFiles": resolved_targets,
            "validation": {
                "valid": True,
                "projectNamesMatch": True,
                "unsafePathCount": 0,
                "missingManifestFileCount": 0,
                "ambiguousManifestFileCount": 0,
                "warnings": warnings,
            },
        }
        output_name = safe_output_name(package_number(path), project_name)
        output_path = output_dir / output_name
        output_path.write_text(json.dumps(staged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {
            "projectName": project_name,
            "propertyType": staged["package"]["propertyType"],
            "packageName": path.name,
            "reviewFile": output_name,
            "packageSize": path.stat().st_size,
            "entryCount": len(entries),
            "reraNumbers": rera_numbers,
            "reraPhaseCount": len(phase_records),
            "manifestFileCount": len(resolved_targets),
            "warnings": warnings,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage property ZIPs as separate review JSON files")
    parser.add_argument("source", type=Path, help="Folder containing one ZIP per property")
    parser.add_argument("output", type=Path, help="New or empty output folder for review JSON files")
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.is_dir():
        parser.error(f"Source folder does not exist: {source}")
    packages = sorted(source.glob("*.zip"), key=lambda item: (package_number(item), item.name.lower()))
    if not packages:
        parser.error("Source folder contains no ZIP packages")
    if output.exists() and any(output.iterdir()):
        parser.error(f"Output folder must be empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    records = []
    failures = []
    for position, package in enumerate(packages, 1):
        try:
            records.append(stage_package(package, output))
            print(f"[{position}/{len(packages)}] staged {package.name}")
        except Exception as error:  # Keep the batch report complete.
            failures.append({"packageName": package.name, "error": str(error)})
            print(f"[{position}/{len(packages)}] FAILED {package.name}: {error}", file=sys.stderr)

    projects_by_rera = defaultdict(set)
    for record in records:
        for number in record["reraNumbers"]:
            projects_by_rera[number].add(record["projectName"])
    shared_rera = {
        number: sorted(projects)
        for number, projects in sorted(projects_by_rera.items())
        if len(projects) > 1
    }
    duplicate_names = [
        name for name, count in Counter(normalized_name(record["projectName"]) for record in records).items() if count > 1
    ]
    summary = {
        "schemaVersion": 1,
        "state": "awaiting_review",
        "sourceFolder": str(source),
        "outputFolder": str(output),
        "packageCount": len(packages),
        "stagedCount": len(records),
        "failedCount": len(failures),
        "duplicateNormalizedProjectNames": duplicate_names,
        "sharedReraNumbers": shared_rera,
        "records": records,
        "failures": failures,
        "nextStep": "Review these files. No MongoDB or Cloudinary changes have been made.",
    }
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nStaged {len(records)}/{len(packages)} packages in {output}")
    print(f"Shared RERA warnings: {len(shared_rera)}; failures: {len(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
