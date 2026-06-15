#!/usr/bin/env python3
"""Render data/downloads.png from the data/downloads.jsonl time series.

Each line is {"date": "YYYY-MM-DD", "tag": "v0.1.x", "installers": N, "total": N}.
The .jsonl keeps the per-release breakdown, but the chart shows a single
CUMULATIVE line: total *installer* downloads (.dmg/.exe/.AppImage — real human
installs) summed across all releases, over time.
"""
import collections
import json
import os
from datetime import datetime, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

DATA = "data/downloads.jsonl"
OUT = "data/downloads.png"


def main():
    if not os.path.exists(DATA):
        raise SystemExit(f"{DATA} not found — nothing to plot yet.")

    # sum installers across all releases per date; last value wins per (tag, date)
    # so manual re-runs on the same day don't double-count.
    per_date_tag = collections.defaultdict(dict)  # date -> {tag: installers}
    for line in open(DATA):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        per_date_tag[r["date"]][r["tag"]] = r.get("installers", r.get("total", 0))

    dates = sorted(per_date_tag)
    xs = [datetime.fromisoformat(d) for d in dates]
    ys = [sum(per_date_tag[d].values()) for d in dates]

    plt.figure(figsize=(11, 5.5))
    plt.plot(xs, ys, marker=".", linewidth=1.8, color="#2563eb",
             label="all releases")
    if ys:
        plt.annotate(f"{ys[-1]:,}", (xs[-1], ys[-1]),
                     textcoords="offset points", xytext=(6, 6),
                     fontsize=10, fontweight="bold")

    # single-day data has no range to autoscale — pad the x-axis so it reads sensibly
    lo, hi = min(xs), max(xs)
    pad = timedelta(days=max(3, (hi - lo).days * 0.05))
    plt.xlim(lo - pad, hi + pad)
    plt.ylim(bottom=0)

    plt.title("dhee-desktop — total installer downloads (all releases)")
    plt.ylabel("cumulative installer downloads")
    plt.xlabel("date")
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUT, dpi=120)
    print(f"Wrote {OUT} (latest total: {ys[-1] if ys else 0})")


if __name__ == "__main__":
    main()
