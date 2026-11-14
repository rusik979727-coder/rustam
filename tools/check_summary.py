#!/usr/bin/env python3
"""Print the latest `hyperframes check` report as a short list."""
import glob, json, os
f = max(glob.glob("project/.hyperframes/artifacts/checks/*.json"), key=os.path.getmtime)
d = json.load(open(f))
for sec, v in d.items():
    if isinstance(v, dict) and "findings" in v:
        print(f"== {sec}: ok={v.get('ok')} err={v.get('errorCount')} warn={v.get('warningCount')} info={v.get('infoCount')}")
        for x in v["findings"]:
            print("  ", x.get("severity"), x.get("code") or x.get("rule"), "|", (x.get("message") or "")[:200].replace("\n", " "),
                  "|", x.get("selector") or x.get("sourceFile"), x.get("time", ""))
