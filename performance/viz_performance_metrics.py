#!/usr/bin/env python3
"""
viz_perf_metrics.py

Compare performance-metric CSVs produced by the Chrome-extension experiments.

Usage
-----
python viz_perf_metrics.py \
       --offscreen resnet_50_offscreen_desktop.csv mobilenet_v3_100_offscreen_desktop.csv ... \
       --injected resnet_50_injected_desktop.csv mobilenet_v3_100_injected_desktop.csv ...

Notes
-----
• Each CSV is assumed to follow the schema described in Chapter 3:
  rows of type == 'inference_aggregated' hold 10-s windows with
  columns like avgFps, processing_avg, inference_avg, preparation_avg, postProcessing_avg, etc.
• Model name is inferred from the file name by stripping the trailing
  "_offscreen_desktop.csv" or "_injected_desktop.csv".
• Matplotlib defaults are kept (no colour palette specified) so you
  can tweak them interactively or via rcParams if desired.
"""

from __future__ import annotations
import argparse
from pathlib import Path
from typing import List
import matplotlib
matplotlib.use("Agg")

import pandas as pd
import matplotlib.pyplot as plt


# ──────────────────────────────── helpers ────────────────────────────────
def load_metrics(files: List[str], mode: str) -> pd.DataFrame:
    """
    Read and concatenate metric CSVs, annotating with model & mode.
    """
    dfs = []
    suffix = f"_{mode}_desktop.csv"
    for f in files:
        df = pd.read_csv(f)
        df = df[df["type"] == "inference_aggregated"].copy()

        # Derive model name from the file name.
        model_name = Path(f).name.removesuffix(suffix)
        df["Model"] = model_name
        df["Mode"] = mode
        dfs.append(df)

    if not dfs:
        raise ValueError(f"No valid rows found for mode='{mode}'.")
    return pd.concat(dfs, ignore_index=True)


def summarise(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute per-model mean metrics for plotting.
    """
    summary = (
        df.groupby(["Model", "Mode"])
        .agg(
            mean_fps=("avgFps", "mean"),
            mean_processing=("processing_avg", "mean"),
            mean_inference=("inference_avg", "mean"),
            mean_preparation=("preparation_avg", "mean"),
            mean_postproc=("postProcessing_avg", "mean"),
        )
        .reset_index()
    )
    return summary


# ──────────────────────────────── plotting ───────────────────────────────
def plot_mean_fps(summary: pd.DataFrame):
    plt.figure(figsize=(10, 5))
    pivot = summary.pivot(index="Model", columns="Mode", values="mean_fps")
    pivot.plot(kind="bar", ax=plt.gca())
    plt.title("Mean FPS by Model and Implementation")
    plt.ylabel("Frames Per Second (higher is better)")
    plt.tight_layout()


def plot_mean_latency(summary: pd.DataFrame):
    plt.figure(figsize=(10, 5))
    pivot = summary.pivot(index="Model", columns="Mode", values="mean_processing")
    pivot.plot(kind="bar", ax=plt.gca())
    plt.title("Mean end-to-end frame latency")
    plt.ylabel("Latency (ms, lower is better)")
    plt.tight_layout()


def plot_latency_breakdown(summary: pd.DataFrame):
    plt.figure(figsize=(12, 6))
    # Build stacked bars: preparation + inference + postproc
    models = summary["Model"].unique()
    width = 0.35
    x = range(len(models))

    for idx, mode in enumerate(["offscreen", "injected"]):
        subset = summary[summary["Mode"] == mode].sort_values("Model")
        bottoms = [0] * len(models)

        for part, label in [
            ("mean_preparation", "Preparation"),
            ("mean_inference", "Inference"),
            ("mean_postproc", "Post-processing"),
        ]:
            heights = subset[part].tolist()
            plt.bar(
                [i + (idx - 0.5) * width for i in x],
                heights,
                width,
                bottom=bottoms,
                label=f"{label} ({mode})" if idx == 0 else None,  # legend once
            )
            bottoms = [b + h for b, h in zip(bottoms, heights)]

    plt.xticks([i for i in x], models, rotation=45, ha="right")
    plt.ylabel("Latency (ms)")
    plt.title("Latency stage breakdown")
    plt.tight_layout()
    plt.legend(ncol=2)


def plot_latency_box(df: pd.DataFrame):
    """
    Optional: distribution of processing latency across all frames.
    """
    plt.figure(figsize=(10, 5))
    df.boxplot(column="processing_avg", by=["Model", "Mode"], rot=45)
    plt.suptitle("")  # kill automatic title
    plt.title("Latency distribution (per-frame processing_avg)")
    plt.ylabel("ms")
    plt.tight_layout()


# ──────────────────────────────── main ───────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Visualise Chrome-extension ML performance CSVs."
    )
    parser.add_argument(
        "--offscreen",
        nargs="+",
        metavar="FILE",
        required=True,
        help="List of *off-screen* CSV files",
    )
    parser.add_argument(
        "--injected",
        nargs="+",
        metavar="FILE",
        required=True,
        help="List of *content-script* CSV files",
    )
    parser.add_argument(
        "--boxplot",
        action="store_true",
        help="Include latency distribution box-and-whisker plot",
    )
    args = parser.parse_args()

    # ── Load & merge ────────────────────────────────────────────────────
    df_off = load_metrics(args.offscreen, "offscreen")
    df_inj = load_metrics(args.injected, "injected")
    df_all = pd.concat([df_off, df_inj], ignore_index=True)

    summary = summarise(df_all)

    # ── Generate graphs ────────────────────────────────────────────────
    plot_mean_fps(summary)
    plot_mean_latency(summary)
    plot_latency_breakdown(summary)

    if args.boxplot:
        plot_latency_box(df_all)

    #plt.show()
    for i, fig in enumerate(plt.get_fignums(), start=1):
        plt.figure(fig)
        plt.savefig(f"figure_{i}.png", dpi=150, bbox_inches="tight")
    print("[✓] Saved", len(plt.get_fignums()), "figures to the current folder")


if __name__ == "__main__":
    main()

