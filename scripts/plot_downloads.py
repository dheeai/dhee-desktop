#!/usr/bin/env python3
"""Render data/downloads.png from the data/downloads.jsonl time series.

Each line is {"date": "YYYY-MM-DD", "tag": "v0.1.x", "installers": N, "total": N}.
Plots cumulative *installer* downloads (.dmg/.exe/.AppImage — real human installs)
per release over time. One row per release per day is appended by the
track-downloads workflow.
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

    # last value wins per (tag, date) so manual re-runs on the same day don't duplicate points
    series = collections.defaultdict(dict)
    for line in open(DATA):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        series[r["tag"]][r["date"]] = r.get("installers", r.get("total", 0))

    plt.figure(figsize=(11, 5.5))
    all_dates = []
    # newest release last in legend; sort tags naturally-ish by their date span
    for tag in sorted(series, key=lambda t: min(series[t])):
        pts = sorted(series[tag].items())
        xs = [datetime.fromisoformat(d) for d, _ in pts]
        ys = [n for _, n in pts]
        all_dates += xs
        plt.plot(xs, ys, marker=".", linewidth=1.6, label=tag)

    # single-day data has no range to autoscale — pad the x-axis so it reads sensibly
    lo, hi = min(all_dates), max(all_dates)
    pad = timedelta(days=max(3, (hi - lo).days * 0.05))
    plt.xlim(lo - pad, hi + pad)

    plt.title("dhee-desktop — installer downloads per release")
    plt.ylabel("cumulative installer downloads")
    plt.xlabel("date")
    plt.grid(alpha=0.3)
    plt.legend(fontsize=8, ncol=2)
    plt.tight_layout()
    plt.savefig(OUT, dpi=120)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
